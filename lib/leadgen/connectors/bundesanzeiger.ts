import fs from 'fs';
import readline from 'readline';
import { trenneFirma } from '../normalize/firma';
import { parseRegister } from '../normalize/register';
import type { Connector, NormalisierterSatz, RawDocument } from '../types';

// Bundesanzeiger / Unternehmensregister: Jahresabschlüsse für Mitarbeiterzahl, Größenklasse nach § 267 HGB und Umsatz.
//
// Zugriff: Bundesanzeiger und Unternehmensregister haben keine offene API, und ihre Nutzungsbedingungen für automatisierte Abrufe sind
// hier nicht verifiziert. Deshalb gibt es zwei Wege: (1) `JahresabschlussDateiConnector` liest Jahresabschlusstexte aus einer lokalen
// Datei (JSON Lines), die man rechtmäßig bezogen hat (z. B. lizenzierter Export, North Data, eigene Recherche); (2)
// `BundesanzeigerConnector` ist der Abruf im Netz: standardmäßig AUS (LEADGEN_BA_LIVE=1), gedrosselt, mit austauschbarem Abruf und ohne
// eingebauten Scraper. Beide liefern dasselbe Rohdokumentformat und teilen sich Parser und Normalisierer.

export const BUNDESANZEIGER = 'bundesanzeiger';

export type JahresabschlussDokument = {
  name: string;
  registerart?: string | null;
  registernummer?: string | null;
  registergericht?: string | null;
  /** Bilanzstichtag (ISO-Datum); fehlt er, wird er aus dem Text gelesen */
  stichtag?: string | null;
  text: string;
};

const zahl = (s: string): number => Number(s.replace(/\./g, '').replace(',', '.'));
const plausibel = (n: number) => Number.isFinite(n) && n >= 1 && n <= 500_000;

export type Jahresabschluss = { mitarbeiterZahl: number | null; klasse: 'hgb_klein' | 'hgb_mittel' | 'hgb_gross' | null; umsatzEur: number | null; stichtag: number | null };

/**
 * Liest aus einem Jahresabschlusstext die durchschnittliche Arbeitnehmerzahl (Anhangsangabe nach § 285 Nr. 7 HGB), die Größenklasse
 * nach § 267 HGB, die Umsatzerlöse und den Bilanzstichtag. Was nicht im Text steht, bleibt null; es wird nichts geschätzt.
 */
export function parseJahresabschluss(text: string): Jahresabschluss {
  const t = text.replace(/\s+/g, ' ');
  const muster = [
    /durchschnittlich\s+(?:beschäftigte\s+)?(\d[\d.]*)\s+(?:Arbeitnehmer|Mitarbeiter|Beschäftigte)/i,
    /(?:Zahl|Anzahl)\s+der\s+[^.:]{0,100}?(?:Arbeitnehmer|Mitarbeiter|Beschäftigten)[^0-9]{0,80}?(\d[\d.]*)/i,
    /(?:Arbeitnehmer|Mitarbeiter)\s+(?:im\s+Jahresdurchschnitt|durchschnittlich)[:\s]+(\d[\d.]*)/i,
    /Jahresdurchschnitt[^.]{0,40}?(\d[\d.]*)\s+(?:Arbeitnehmer|Mitarbeiter|Beschäftigte)/i,
  ];
  let mitarbeiterZahl: number | null = null;
  for (const m of muster) {
    const g = m.exec(t)?.[1];
    if (g && plausibel(zahl(g))) {
      mitarbeiterZahl = Math.round(zahl(g));
      break;
    }
  }
  const k = /(kleinst|kleine|mittelgro(?:ß|ss)e|gro(?:ß|ss)e)\w*\s+(?:Kapitalgesellschaft|Gesellschaft|Personenhandelsgesellschaft|GmbH|AG)[^.]{0,100}?§\s*267/i.exec(t)?.[1]?.toLowerCase();
  const klasse = k ? (k.startsWith('klein') ? 'hgb_klein' : k.startsWith('mittel') ? 'hgb_mittel' : 'hgb_gross') : null;

  let umsatzEur: number | null = null;
  const u = /Umsatzerl(?:ö|oe)se[^0-9]{0,40}?(\d[\d.]*(?:,\d+)?)\s*(TEUR|T€|Mio\.?\s*(?:EUR|€)|EUR|€)/i.exec(t);
  if (u) {
    const betrag = zahl(u[1]);
    const einheit = u[2].toLowerCase();
    umsatzEur = Math.round(einheit.startsWith('t') ? betrag * 1000 : einheit.startsWith('mio') ? betrag * 1_000_000 : betrag);
  }

  let stichtag: number | null = null;
  const d = /(?:Gesch(?:ä|ae)ftsjahr|Jahresabschluss|Bilanz)[^.]{0,60}?(?:zum|bis(?:\s+zum)?)\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/i.exec(t);
  if (d) stichtag = Date.UTC(Number(d[3]), Number(d[2]) - 1, Number(d[1]));
  return { mitarbeiterZahl, klasse, umsatzEur, stichtag };
}

/** Normalisiert ein Jahresabschluss-Rohdokument (Stufe 2): Firma und Register zum Zuordnen, dazu Mitarbeiterangaben mit Bilanzstichtag. */
export function normalisiereBundesanzeiger(doc: RawDocument): NormalisierterSatz | null {
  let d: JahresabschlussDokument;
  try {
    d = JSON.parse(doc.inhalt) as JahresabschlussDokument;
  } catch {
    return null;
  }
  if (!d || typeof d.name !== 'string' || typeof d.text !== 'string') return null;
  const ja = parseJahresabschluss(d.text);
  const stichtag = d.stichtag ? Date.parse(d.stichtag) : ja.stichtag;
  const reg = d.registernummer ? { art: d.registerart ?? null, nummer: d.registernummer, gericht: d.registergericht ?? null } : parseRegister(d.text);
  if (ja.mitarbeiterZahl === null && !ja.klasse && ja.umsatzEur === null) return null;
  const firma = trenneFirma(d.name);
  return {
    quelle: doc.quelle,
    referenz: doc.referenz,
    name: firma.name,
    rechtsform: firma.rechtsform,
    nameNormalized: firma.nameNormalized,
    registerart: reg.art,
    registernummer: reg.nummer,
    registergericht: reg.gericht,
    sitz: null,
    adresse: null,
    status: null,
    personen: [],
    mitarbeiter: { zahl: ja.mitarbeiterZahl, klasse: ja.klasse, stichtag: Number.isFinite(stichtag ?? NaN) ? stichtag : null },
    umsatzEur: ja.umsatzEur,
  };
}

/** Jahresabschlüsse aus einer lokalen JSONL-Datei (eine Zeile je Dokument, Felder siehe `JahresabschlussDokument`). */
export class JahresabschlussDateiConnector implements Connector {
  readonly quelle = BUNDESANZEIGER;
  constructor(private readonly datei: string) {}
  async *fetch(): AsyncIterable<RawDocument> {
    const zeilen = readline.createInterface({ input: fs.createReadStream(this.datei), crlfDelay: Infinity });
    for await (const zeile of zeilen) {
      if (!zeile.trim()) continue;
      let d: JahresabschlussDokument;
      try {
        d = JSON.parse(zeile) as JahresabschlussDokument;
      } catch {
        continue;
      }
      if (typeof d?.name !== 'string' || typeof d.text !== 'string') continue;
      const referenz = [d.registergericht, d.registerart, d.registernummer, d.stichtag].filter(Boolean).join('|') || d.name;
      yield { quelle: BUNDESANZEIGER, referenz, contentType: 'application/json', inhalt: zeile };
    }
  }
}

export class BundesanzeigerDeaktiviert extends Error {
  constructor() {
    super('Der Abruf beim Bundesanzeiger ist deaktiviert (LEADGEN_BA_LIVE=1 setzen, nachdem die Nutzungsbedingungen geprüft sind). Alternativ Jahresabschlüsse per Datei importieren.');
  }
}

export type BaAbruf = (suche: { name: string; registerKey?: string | null }) => Promise<JahresabschlussDokument[]>;

export class BundesanzeigerConnector implements Connector {
  readonly quelle = BUNDESANZEIGER;
  private letzter = 0;
  constructor(private readonly opt: { firmen: Array<{ name: string; registerKey?: string | null }>; aktiv?: boolean; abruf?: BaAbruf; minAbstandMs?: number; jetzt?: () => number; warte?: (ms: number) => Promise<void> }) {}

  async *fetch(): AsyncIterable<RawDocument> {
    // Ausdrücklich freigegeben (Option oder LEADGEN_BA_LIVE=1), sonst aus
    if (!(this.opt.aktiv ?? process.env.LEADGEN_BA_LIVE === '1')) throw new BundesanzeigerDeaktiviert();
    if (!this.opt.abruf) throw new Error('Kein Abruf für den Bundesanzeiger konfiguriert (noch nicht implementiert).');
    const jetzt = this.opt.jetzt ?? Date.now;
    const warte = this.opt.warte ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (const f of this.opt.firmen) {
      const warten = this.letzter + (this.opt.minAbstandMs ?? 60_000) - jetzt();
      if (warten > 0) await warte(warten);
      this.letzter = jetzt();
      for (const d of await this.opt.abruf(f)) {
        const referenz = [d.registergericht, d.registerart, d.registernummer, d.stichtag].filter(Boolean).join('|') || d.name;
        yield { quelle: BUNDESANZEIGER, referenz, contentType: 'application/json', inhalt: JSON.stringify(d) };
      }
    }
  }
}
