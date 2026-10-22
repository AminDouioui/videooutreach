import { normalisiereText } from '../resolve/match';
import type { SearchProvider, SuchTreffer } from '../search/provider';
import type { HoeflicherFetcher } from './fetcher';
import { gleicheSeite, seitenText, waehleSeiten } from './seiten';

// Stufe 4a: Domain zur Firma finden. Kandidaten über die Websuche (Name plus Ort), Verifikation über das Impressum:
// Es muss den Firmennamen oder die Registernummer nennen, sonst gilt der Kandidat nicht.

/** Verzeichnisse, Portale und Netzwerke: nie die eigene Domain der Firma */
const VERZEICHNISSE = [
  'northdata', 'firmenwissen', 'wlw.de', 'linkedin', 'xing', 'facebook', 'instagram', 'twitter', 'x.com', 'youtube', 'kompass', 'europages', 'dnb.com',
  'creditreform', 'handelsregister', 'unternehmensregister', 'bundesanzeiger', 'gelbeseiten', 'dasoertliche', '11880', 'yelp', 'indeed', 'stepstone', 'kununu',
  'wikipedia', 'google.', 'bing.', 'opencorporates', 'moneyhouse', 'cylex', 'meinestadt', 'firmenabc', 'wer-zu-wem', 'hotfrog', 'amazon', 'ebay', 'ihk.de',
  'handwerkskammer', 'branchenbuch', 'firmenverzeichnis', 'online-handelsregister', 'implisense', 'dnbhoovers', 'zoominfo', 'crunchbase', 'glassdoor', 'trustpilot',
];

export const DOMAIN_SUCHVORLAGEN = ['"{name}" {ort}', '{name} {ort} Impressum'] as const;

export type FirmaFuerDomain = {
  /** Name ohne Rechtsform */
  name: string;
  nameNormalized: string;
  rechtsform?: string | null;
  ort: string | null;
  plz?: string | null;
  registerArt?: string | null;
  registerNummer?: string | null;
};

export type DomainKandidat = { domain: string; url: string; punkte: number };
export type DomainErgebnis = {
  domain: string;
  startUrl: string;
  beleg: 'registernummer' | 'firmenname_und_plz' | 'firmenname';
  konfidenz: number;
  kandidaten: string[];
};

export function hostVon(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function istVerzeichnis(host: string): boolean {
  return VERZEICHNISSE.some((v) => host.includes(v));
}

/** Bewertet Suchtreffer: Namenswörter in der Domain zählen am meisten, frühe Treffer und mehrfache Nennungen etwas. */
export function bewerteKandidaten(treffer: SuchTreffer[], nameNormalized: string): DomainKandidat[] {
  const tokens = normalisiereText(nameNormalized).split(' ').filter((t) => t.length >= 3);
  const proHost = new Map<string, DomainKandidat>();
  treffer.forEach((t, i) => {
    const host = hostVon(t.url);
    if (!host || istVerzeichnis(host)) return;
    const hostText = normalisiereText(host.replace(/\.[a-z]{2,}$/, ''));
    const kompakt = hostText.replace(/ /g, '');
    const namensTreffer = tokens.filter((tok) => kompakt.includes(tok)).length;
    const punkte = namensTreffer * 3 + Math.max(0, 3 - i * 0.3) + (normalisiereText(`${t.titel} ${t.snippet}`).includes(normalisiereText(nameNormalized)) ? 2 : 0);
    const alt = proHost.get(host);
    if (alt) alt.punkte += punkte + 1;
    else proHost.set(host, { domain: host, url: new URL(t.url).origin, punkte });
  });
  return [...proHost.values()].sort((a, b) => b.punkte - a.punkte);
}

/** Prüft den Impressumstext: Registernummer (stärker) oder Firmenname (mit PLZ noch stärker). */
export function pruefeImpressum(text: string, f: FirmaFuerDomain): { beleg: DomainErgebnis['beleg']; konfidenz: number } | null {
  const norm = normalisiereText(text);
  if (f.registerArt && f.registerNummer) {
    const muster = new RegExp(`\\b${f.registerArt.toLowerCase()}\\s*${f.registerNummer}\\b`);
    if (muster.test(norm)) return { beleg: 'registernummer', konfidenz: 0.98 };
  }
  const name = normalisiereText(f.nameNormalized);
  if (name && ` ${norm} `.includes(` ${name} `)) {
    if (f.plz && norm.includes(f.plz)) return { beleg: 'firmenname_und_plz', konfidenz: 0.95 };
    return { beleg: 'firmenname', konfidenz: 0.85 };
  }
  return null;
}

/**
 * Sucht und verifiziert die Domain. Liefert null, wenn kein Kandidat per Impressum bestätigt ist (lieber keine Domain als eine falsche).
 * Es werden höchstens `maxKandidaten` Domains geprüft, damit die Kosten je Firma begrenzt bleiben.
 */
export async function findeDomain(f: FirmaFuerDomain, suche: SearchProvider, fetcher: HoeflicherFetcher, opt: { vorlagen?: readonly string[]; maxKandidaten?: number } = {}): Promise<DomainErgebnis | null> {
  const treffer: SuchTreffer[] = [];
  for (const v of opt.vorlagen ?? DOMAIN_SUCHVORLAGEN) {
    const anfrage = v.replace('{name}', f.name).replace('{ort}', f.ort ?? '').replace(/\s+/g, ' ').trim();
    treffer.push(...(await suche.suche(anfrage, { anzahl: 10 })));
  }
  const kandidaten = bewerteKandidaten(treffer, f.nameNormalized).slice(0, opt.maxKandidaten ?? 3);
  for (const k of kandidaten) {
    const start = await fetcher.holeSeite(k.url);
    if (start.status !== 'ok') continue;
    // Ohne Weiterleitung auf eine fremde Domain
    if (!gleicheSeite(start.finaleUrl, k.url)) continue;
    const ziele = waehleSeiten(start.html, start.finaleUrl).filter((z) => z.art === 'impressum');
    for (const z of ziele) {
      const seite = await fetcher.holeSeite(z.url);
      if (seite.status !== 'ok') continue;
      const ergebnis = pruefeImpressum(seitenText(seite.html), f);
      if (ergebnis) return { domain: k.domain, startUrl: start.finaleUrl, ...ergebnis, kandidaten: kandidaten.map((x) => x.domain) };
    }
    // Manche Firmen nennen sich schon auf der Startseite im Fuß
    const ergebnis = pruefeImpressum(seitenText(start.html), f);
    if (ergebnis && ergebnis.beleg === 'registernummer') return { domain: k.domain, startUrl: start.finaleUrl, ...ergebnis, kandidaten: kandidaten.map((x) => x.domain) };
  }
  return null;
}
