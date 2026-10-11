import { LEAD_STATUS, LEAD_STATUS_INFO, type LeadStatus } from './lead-status';

// Pipeline (CRM light): Deal-Wert-Parsing/-Formatierung und Aggregation der Kanban-Spalten – reine Logik

const TAG_MS = 24 * 60 * 60 * 1000;
/** Obergrenze für einen Deal-Wert in Cent (10 Mrd. €) – schützt vor Tippfehlern und Zahlenüberlauf */
export const DEAL_WERT_MAX_CENT = 1_000_000_000_000;

export type DealWertErgebnis = { ok: true; cent: number | null } | { ok: false };

/**
 * Wandelt eine Eingabe wie „1.234,50 €“, „1234,5“, „1234.50“ oder „€ 2.000“ in Cent um. Leer = kein Wert (null).
 * Das letzte Trennzeichen gilt als Dezimaltrenner, wenn es ein Komma ist oder ein einzelner Punkt mit 1–2 Nachkommastellen;
 * ein Punkt mit genau drei Ziffern danach ist ein Tausenderpunkt. Negative Werte und Text sind ungültig.
 */
export function parseDealWert(eingabe: string | number | null | undefined): DealWertErgebnis {
  if (eingabe === null || eingabe === undefined) return { ok: true, cent: null };
  if (typeof eingabe === 'number') return Number.isFinite(eingabe) && eingabe >= 0 ? pruefeCent(Math.round(eingabe * 100)) : { ok: false };
  let t = eingabe.replace(/€|eur(o)?\b/gi, '').replace(/[\s ']/g, '');
  if (t === '') return { ok: true, cent: null };
  if (!/^\d[\d.,]*$/.test(t)) return { ok: false };
  const komma = t.lastIndexOf(',');
  const punkt = t.lastIndexOf('.');
  let dezimal = '';
  if (komma >= 0 && punkt >= 0) {
    // Beide vorhanden: das hintere ist der Dezimaltrenner, das andere der Tausendertrenner
    const sep = Math.max(komma, punkt);
    dezimal = t.slice(sep + 1);
    t = t.slice(0, sep);
  } else if (komma >= 0) {
    // Mehrere Kommas = Tausendertrenner ohne Dezimalteil
    if (t.indexOf(',') === komma) {
      dezimal = t.slice(komma + 1);
      t = t.slice(0, komma);
    }
  } else if (punkt >= 0 && t.indexOf('.') === punkt) {
    const nach = t.slice(punkt + 1);
    if (nach.length !== 3) {
      dezimal = nach;
      t = t.slice(0, punkt);
    }
  }
  const ganz = t.replace(/[.,]/g, '');
  if (ganz === '' || !/^\d*$/.test(dezimal) || dezimal.length > 2) return { ok: false };
  return pruefeCent(Number(ganz) * 100 + Number(dezimal.padEnd(2, '0') || '0'));
}

function pruefeCent(cent: number): DealWertErgebnis {
  return Number.isSafeInteger(cent) && cent >= 0 && cent <= DEAL_WERT_MAX_CENT ? { ok: true, cent } : { ok: false };
}

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** Cent als Euro im deutschen Format, z. B. 123450 → „1.234,50 €“; null → „–“ */
export function formatEuro(cent: number | null | undefined): string {
  return cent === null || cent === undefined ? '–' : euro.format(cent / 100);
}

/** Cent als Eingabetext fürs Formularfeld („1234,50“), null → leer */
export function dealWertEingabe(cent: number | null | undefined): string {
  if (cent === null || cent === undefined) return '';
  return (cent / 100).toFixed(2).replace('.', ',');
}

export type PipelineLead = {
  id: number;
  campaignId: number;
  leadStatus: string;
  leadStatusAt: Date | number | null;
  flowStopp: string | null;
  antwortAt?: Date | number | null;
  flowStoppAt?: Date | number | null;
  dealWert: number | null;
};

/** Gehört der Lead in die Pipeline? Nur mit Antwort oder Status ≠ offen. */
export function inPipeline(l: Pick<PipelineLead, 'leadStatus' | 'flowStopp'>): boolean {
  return l.leadStatus !== 'offen' || l.flowStopp === 'beantwortet';
}

const ms = (d: Date | number | null | undefined): number | null => (d === null || d === undefined ? null : typeof d === 'number' ? d : d.getTime());

/** Volle Tage seit dem Statuswechsel (bei „offen“ seit der Antwort); null, wenn kein Zeitpunkt bekannt ist */
export function tageImStatus(l: Pick<PipelineLead, 'leadStatusAt' | 'antwortAt' | 'flowStoppAt'>, jetzt: Date): number | null {
  const seit = ms(l.leadStatusAt) ?? ms(l.antwortAt) ?? ms(l.flowStoppAt);
  return seit === null ? null : Math.max(0, Math.floor((jetzt.getTime() - seit) / TAG_MS));
}

export type PipelineSpalte<T extends PipelineLead> = { status: LeadStatus; leads: T[]; anzahl: number; summeCent: number };

/**
 * Gruppiert die Leads in eine Spalte je Lead-Status (Reihenfolge wie LEAD_STATUS, auch leere Spalten). Optional nur eine
 * Kampagne. Innerhalb der Spalte: zuletzt gewechselte zuerst. Die Summe zählt nur Leads mit Deal-Wert.
 */
export function aggregierePipeline<T extends PipelineLead>(leads: T[], opt: { campaignId?: number | null } = {}): PipelineSpalte<T>[] {
  const spalten = new Map<LeadStatus, PipelineSpalte<T>>(LEAD_STATUS.map((s) => [s, { status: s, leads: [], anzahl: 0, summeCent: 0 }]));
  for (const l of leads) {
    if (!inPipeline(l)) continue;
    if (opt.campaignId !== undefined && opt.campaignId !== null && l.campaignId !== opt.campaignId) continue;
    const spalte = spalten.get(l.leadStatus as LeadStatus);
    if (!spalte) continue;
    spalte.leads.push(l);
    spalte.anzahl += 1;
    spalte.summeCent += l.dealWert ?? 0;
  }
  const zeit = (l: PipelineLead) => ms(l.leadStatusAt) ?? ms(l.antwortAt) ?? ms(l.flowStoppAt) ?? 0;
  for (const s of spalten.values()) s.leads.sort((a, b) => zeit(b) - zeit(a) || b.id - a.id);
  return [...spalten.values()];
}

/** Beendet dieser Status den Flow? (für den Hinweis beim Verschieben) */
export function beendetFlow(status: LeadStatus): boolean {
  return LEAD_STATUS_INFO[status].beendetFlow;
}
