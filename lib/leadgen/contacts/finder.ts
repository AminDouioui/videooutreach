import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@/lib/db';
import { seitenText } from '../crawl/seiten';
import type { Suchvorlage } from '../config';
import type { LeadgenDeps } from '../deps';
import { groundingKontext, nameImText, rolleImText } from '../extract/grounding';
import { PERSONEN_ROLLE_SCHEMA } from '../extract/schemas';
import { mitDecay } from '../golden/survivorship';
import { normalisiereText, vergleichePersonen } from '../resolve/match';
import type { Rollenverzeichnis, RollenTreffer } from './rollen';
import { ROLLEN_FAKTOR } from './rollen';

// Schritt A: Person zur Rolle finden. Mehrere Finder laufen parallel mit gemeinsamem Interface; ihre Treffer werden zusammengeführt.

export type QuelleTyp = 'website' | 'register' | 'suche' | 'stellenanzeige' | 'presse' | 'messe' | 'netzwerk';

export type PersonTreffer = {
  vorname: string | null;
  nachname: string;
  rolle: string;
  quelleTyp: QuelleTyp;
  url: string | null;
  konfidenz: number;
};

export type FirmaKontext = { id: number; name: string; nameNormalized: string; ort: string | null; domain: string | null };

export type FinderKontext = {
  firma: FirmaKontext;
  rolleKey: string;
  rollen: Rollenverzeichnis;
  deps: Pick<LeadgenDeps, 'suche' | 'fetcher' | 'extraktion'>;
  db: Db;
  /** Zeitpunkt der Auswertung (Decay alter Beobachtungen); Standard: jetzt */
  jetzt?: number;
};

export interface PersonenFinder {
  readonly name: string;
  finde(ctx: FinderKontext): Promise<PersonTreffer[]>;
}

/** Personen aus den eigenen Daten: Register (Geschäftsführer) und die gecrawlte Firmenwebseite (Impressum, Team, Management). */
export class WebsiteFinder implements PersonenFinder {
  readonly name = 'website';
  async finde(ctx: FinderKontext): Promise<PersonTreffer[]> {
    const zeilen = ctx.db
      .select()
      .from(schema.attributeObservations)
      .innerJoin(schema.persons, eq(schema.attributeObservations.entityId, schema.persons.id))
      .where(and(eq(schema.attributeObservations.entityType, 'person'), eq(schema.attributeObservations.feld, 'person'), eq(schema.persons.companyId, ctx.firma.id)))
      .all();
    return zeilen.flatMap(({ attribute_observations: o, persons: p }) => {
      const w = o.wert as { rolleOriginal?: string | null; rolle?: string; url?: string };
      const rolle = w.rolleOriginal || w.rolle;
      if (!rolle) return [];
      const quelleTyp: QuelleTyp = o.quelle === 'web' ? 'website' : o.quelle.startsWith('suche') ? 'suche' : 'register';
      // Alte Beobachtungen (z. B. der Registerseed von 2019) verlieren über den Decay an Konfidenz
      return [{ vorname: p.vorname, nachname: p.nachname, rolle, quelleTyp, url: w.url ?? null, konfidenz: mitDecay(o.konfidenz, 'person', o.beobachtetAm.getTime(), ctx.jetzt ?? Date.now()) }];
    });
  }
}

const BASIS_KONFIDENZ: Record<Suchvorlage['tag'], { snippet: number; seite: number }> = {
  suche: { snippet: 0.5, seite: 0.65 },
  stellenanzeige: { snippet: 0.5, seite: 0.6 },
  presse: { snippet: 0.55, seite: 0.65 },
  messe: { snippet: 0.5, seite: 0.6 },
  netzwerk: { snippet: 0.5, seite: 0.5 },
};

/** Berufsnetzwerke und soziale Seiten: nie abrufen, nur die Trefferzeile (Titel und Snippet) der Suchmaschine auswerten. */
const NUR_SNIPPET = /(^|\.)(linkedin|xing|facebook|instagram|twitter|x)\.(com|de)$/i;

function hostVon(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function ersetze(vorlage: string, f: FirmaKontext, rolleLabel: string): string {
  return vorlage.replace('{rolle}', rolleLabel).replace('{firma}', f.name).replace('{ort}', f.ort ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Gezielte Websuche mit Rolle plus Firmenname plus Ort (Vorlagen konfigurierbar). Aus jedem Treffer extrahiert das LLM Vorname,
 * Nachname und exakte Rolle; Name und Rolle müssen im Quelltext stehen (Grounding), und der Text muss die Firma nennen.
 */
export class SucheFinder implements PersonenFinder {
  readonly name: string;
  constructor(
    private readonly vorlagen: Suchvorlage[],
    private readonly opt: { maxTreffer?: number; maxSeitenZeichen?: number } = {},
  ) {
    this.name = `suche:${[...new Set(vorlagen.map((v) => v.tag))].join('+')}`;
  }

  async finde(ctx: FinderKontext): Promise<PersonTreffer[]> {
    const rolle = ctx.rollen.rolle(ctx.rolleKey);
    const label = rolle?.label ?? ctx.rolleKey;
    const eigeneDomain = ctx.firma.domain?.toLowerCase().replace(/^www\./, '') ?? null;
    const gesehen = new Set<string>();
    const kandidaten: Array<{ tag: Suchvorlage['tag']; titel: string; url: string; snippet: string }> = [];
    for (const v of this.vorlagen) {
      for (const t of await ctx.deps.suche.suche(ersetze(v.vorlage, ctx.firma, label), { anzahl: 8 })) {
        const host = hostVon(t.url);
        if (!host || gesehen.has(t.url) || (eigeneDomain && host === eigeneDomain)) continue;
        gesehen.add(t.url);
        kandidaten.push({ tag: v.tag, ...t });
      }
    }
    const treffer: PersonTreffer[] = [];
    const firmaNorm = normalisiereText(ctx.firma.nameNormalized);
    for (const k of kandidaten.slice(0, this.opt.maxTreffer ?? 6)) {
      const host = hostVon(k.url)!;
      let text = `${k.titel}\n${k.snippet}`;
      let ausSeite = false;
      if (!NUR_SNIPPET.test(host)) {
        const seite = await ctx.deps.fetcher.holeSeite(k.url);
        if (seite.status === 'ok') {
          text = `${text}\n${seitenText(seite.html)}`.slice(0, this.opt.maxSeitenZeichen ?? 12_000);
          ausSeite = true;
        }
      }
      const ctxText = groundingKontext(text);
      // Der Text muss die Firma nennen, sonst geht es um jemand anderen
      if (!(ctxText.norm.includes(` ${firmaNorm} `) || (eigeneDomain && text.toLowerCase().includes(eigeneDomain)))) continue;
      const antwort = await ctx.deps.extraktion.extract(text, PERSONEN_ROLLE_SCHEMA);
      for (const p of antwort.personen) {
        if (!p.nachname.trim() || !nameImText(ctxText, p.vorname, p.nachname) || !rolleImText(ctxText, p.rolle)) continue;
        // Nur Rollen, die zur Zielrolle passen oder deren Fallback sind
        if (ctx.rollen.vergleiche(ctx.rolleKey, p.rolle).treffer === 'keiner') continue;
        const basis = BASIS_KONFIDENZ[k.tag];
        treffer.push({ vorname: p.vorname?.trim() || null, nachname: p.nachname.trim(), rolle: p.rolle.trim(), quelleTyp: k.tag, url: k.url, konfidenz: ausSeite ? basis.seite : basis.snippet });
      }
    }
    return treffer;
  }
}

export type PersonCluster = {
  vorname: string | null;
  nachname: string;
  rollen: string[];
  quellen: Array<{ typ: QuelleTyp; url: string | null; konfidenz: number }>;
  /** Zusammengeführte Konfidenz mehrerer unabhängiger Belege: 1 − Π(1 − cᵢ), höchstens 0,97 */
  konfidenz: number;
};

/** Führt Treffer derselben Person (Name wie bei der Entity Resolution verglichen) zusammen; gleiche Quelle-URL zählt nur einmal. */
export function fuehreTrefferZusammen(treffer: PersonTreffer[]): PersonCluster[] {
  const cluster: PersonCluster[] = [];
  for (const t of treffer) {
    const ziel = cluster.find((c) => vergleichePersonen(t, c).entscheidung === 'sicher');
    if (!ziel) {
      cluster.push({ vorname: t.vorname, nachname: t.nachname, rollen: [t.rolle], quellen: [{ typ: t.quelleTyp, url: t.url, konfidenz: t.konfidenz }], konfidenz: t.konfidenz });
      continue;
    }
    if (!ziel.vorname && t.vorname) ziel.vorname = t.vorname;
    else if (ziel.vorname && t.vorname && t.vorname.length > ziel.vorname.length && t.vorname.toLowerCase().startsWith(ziel.vorname.toLowerCase().replace('.', ''))) ziel.vorname = t.vorname;
    if (!ziel.rollen.includes(t.rolle)) ziel.rollen.push(t.rolle);
    if (!ziel.quellen.some((q) => q.typ === t.quelleTyp && q.url === t.url)) ziel.quellen.push({ typ: t.quelleTyp, url: t.url, konfidenz: t.konfidenz });
  }
  for (const c of cluster) c.konfidenz = Math.min(0.97, 1 - c.quellen.reduce((rest, q) => rest * (1 - q.konfidenz), 1));
  return cluster;
}

export type GewaehltePerson = PersonCluster & { rolleText: string; rollenTreffer: RollenTreffer; rollenKey: string | null; personKonfidenz: number };

const RANG: Record<RollenTreffer, number> = { exakt: 3, synonym: 2, fallback: 1, keiner: 0 };

/** Wählt die beste Person für die Zielrolle: erst Rollen-Passung (exakt vor Synonym vor Fallback), dann Konfidenz. */
export function waehlePerson(cluster: PersonCluster[], rolleKey: string, rollen: Rollenverzeichnis): GewaehltePerson | null {
  const bewertet: GewaehltePerson[] = [];
  for (const c of cluster) {
    let beste: { text: string; treffer: RollenTreffer; key: string | null } | null = null;
    for (const text of c.rollen) {
      const r = rollen.vergleiche(rolleKey, text);
      if (r.treffer !== 'keiner' && (!beste || RANG[r.treffer] > RANG[beste.treffer])) beste = { text, treffer: r.treffer, key: r.rolleKey };
    }
    if (beste) bewertet.push({ ...c, rolleText: beste.text, rollenTreffer: beste.treffer, rollenKey: beste.key, personKonfidenz: c.konfidenz * ROLLEN_FAKTOR[beste.treffer] });
  }
  bewertet.sort((a, b) => RANG[b.rollenTreffer] - RANG[a.rollenTreffer] || b.personKonfidenz - a.personKonfidenz);
  return bewertet[0] ?? null;
}
