import { DECAY_UNTERGRENZE, FELD_ART, HALBWERTSZEIT_TAGE, QUELLEN_RANG, STANDARD_HALBWERTSZEIT_TAGE, TYP_RANG, type FeldArt } from '../config';

// Survivorship: aus mehreren Beobachtungen eines Felds den aktuellen Wert bestimmen. Reine Logik ohne Datenbankzugriff, damit der
// Golden Record jederzeit aus den Beobachtungen neu berechenbar und gut testbar ist.

export type Beobachtung = {
  id: number;
  feld: string;
  wert: unknown;
  quelle: string;
  konfidenz: number;
  typ: 'exakt' | 'klasse' | 'schaetzung';
  beobachtetAm: number;
  extraktionRunId?: number | null;
};

export type Gewinner = {
  wert: unknown;
  quelle: string;
  /** Konfidenz nach Decay (Alter der Beobachtung) */
  konfidenz: number;
  /** Ursprüngliche Konfidenz der Quelle */
  konfidenzRoh: number;
  typ: Beobachtung['typ'];
  beobachtetAm: number;
  beobachtungId: number;
};

const TAG_MS = 86_400_000;

/** Konfidenz nach Alter: halbiert sich je Halbwertszeit des Felds, sinkt aber nie unter einen Mindestanteil. */
export function mitDecay(konfidenz: number, feld: string, beobachtetAm: number, jetzt: number): number {
  const alterTage = Math.max(0, (jetzt - beobachtetAm) / TAG_MS);
  const halb = HALBWERTSZEIT_TAGE[feld] ?? STANDARD_HALBWERTSZEIT_TAGE;
  return konfidenz * Math.max(DECAY_UNTERGRENZE, Math.pow(0.5, alterTage / halb));
}

/** Rang der Quelle in der Rangfolge der Feldart (kleiner = besser). „suche:“ passt auf alle Quellen mit diesem Präfix. */
export function quellenRang(art: FeldArt, quelle: string): number {
  const liste = QUELLEN_RANG[art];
  const i = liste.findIndex((q) => (q.endsWith(':') ? quelle.startsWith(q) : quelle === q));
  return i === -1 ? liste.length : i;
}

/**
 * Beobachtungen, die ein neuerer Extraktionslauf ersetzt hat, zählen nicht mehr: je Firma gilt nur der neueste Lauf
 * (Re-Extraktion ohne Neu-Crawl); Beobachtungen ohne Lauf (Register, Domain, Prüfungen) bleiben. Wird auf ALLE Beobachtungen
 * einer Firma angewendet, bevor nach Feldern gruppiert wird.
 */
export function aktuelleBeobachtungen<T extends { extraktionRunId?: number | null }>(beobachtungen: T[]): T[] {
  const laeufe = beobachtungen.map((b) => b.extraktionRunId).filter((r): r is number => typeof r === 'number');
  if (!laeufe.length) return beobachtungen;
  const neuester = Math.max(...laeufe);
  return beobachtungen.filter((b) => b.extraktionRunId == null || b.extraktionRunId === neuester);
}

/**
 * Wählt den Gewinner: erst Typ (nur Mitarbeiterzahl: exakt vor Klasse vor Schätzung), dann Rang der Quelle, bei gleicher Quelle
 * gewinnt die neuere Beobachtung („neuer schlägt alt“), zuletzt die höhere Konfidenz. Leere Werte zählen nie.
 */
export function waehleGewinner(feld: string, beobachtungen: Beobachtung[], jetzt: number): Gewinner | null {
  const art = FELD_ART[feld];
  if (!art) return null;
  const kandidaten = beobachtungen.filter((b) => b.wert !== null && b.wert !== undefined && b.wert !== '');
  if (!kandidaten.length) return null;
  const sortiert = [...kandidaten].sort((a, b) => {
    if (art === 'mitarbeiter' && a.typ !== b.typ) return TYP_RANG[a.typ] - TYP_RANG[b.typ];
    const r = quellenRang(art, a.quelle) - quellenRang(art, b.quelle);
    if (r !== 0) return r;
    if (a.beobachtetAm !== b.beobachtetAm) return b.beobachtetAm - a.beobachtetAm;
    return mitDecay(b.konfidenz, feld, b.beobachtetAm, jetzt) - mitDecay(a.konfidenz, feld, a.beobachtetAm, jetzt) || b.id - a.id;
  });
  const g = sortiert[0];
  return { wert: g.wert, quelle: g.quelle, konfidenz: mitDecay(g.konfidenz, feld, g.beobachtetAm, jetzt), konfidenzRoh: g.konfidenz, typ: g.typ, beobachtetAm: g.beobachtetAm, beobachtungId: g.id };
}

// ---------------------------------------------------------------- Mitarbeiterzahl

export const MITARBEITER_KLASSEN = ['<50', '50-99', '100-249', '250-499', '500-800', '>800'] as const;

/** Unsere Größenklasse zu einer Mitarbeiterzahl */
export function mitarbeiterKlasse(zahl: number): (typeof MITARBEITER_KLASSEN)[number] {
  if (zahl < 50) return '<50';
  if (zahl < 100) return '50-99';
  if (zahl < 250) return '100-249';
  if (zahl < 500) return '250-499';
  if (zahl <= 800) return '500-800';
  return '>800';
}

/** Größenklassen nach § 267 HGB (nur das Merkmal Arbeitnehmerzahl im Jahresdurchschnitt): klein ≤ 50, mittel ≤ 250, groß > 250 */
export function hgbKlasseVonZahl(zahl: number): 'hgb_klein' | 'hgb_mittel' | 'hgb_gross' {
  return zahl <= 50 ? 'hgb_klein' : zahl <= 250 ? 'hgb_mittel' : 'hgb_gross';
}
