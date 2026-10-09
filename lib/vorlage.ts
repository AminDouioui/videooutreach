import { pruefeKlammern } from './spintax';

// Reine Hilfen für Vorlagen-Variablen (auch im Browser nutzbar, daher keine Node-Importe).

/** Eingebaute Platzhalter */
export const STANDARD_VARIABLEN = [
  'begruessung',
  'anrede',
  'vorname',
  'nachname',
  'name',
  'firma',
  'position',
  'website',
  'email',
  'absender_name',
  'video_link',
  'vorschaubild',
] as const;

/** Muster eines Platzhalters: `{{name}}` bzw. `{{name|Fallback}}` (Fallback ohne Klammern). */
export const PLATZHALTER_MUSTER = /\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|([^{}]*))?\}\}/g;

const UMLAUTE: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** Spaltenname → Variablenname: klein, Umlaute aufgelöst, alles andere → `_`. Leer, wenn nichts übrig bleibt. */
export function normalisiereSpaltenname(spalte: string): string {
  return spalte
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTE[c])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Extra-Werte eines Leads mit normalisierten Schlüsseln (bei Kollision gewinnt die erste Spalte). */
export function extraVariablen(extra: Record<string, string> | null | undefined): Record<string, string> {
  const aus: Record<string, string> = {};
  for (const [spalte, wert] of Object.entries(extra ?? {})) {
    const k = normalisiereSpaltenname(spalte);
    if (k && !Object.prototype.hasOwnProperty.call(aus, k)) aus[k] = String(wert ?? '').trim();
  }
  return aus;
}

/** Alle Variablennamen (klein) einer Vorlage, in Reihenfolge, ohne Doppelte. */
export function verwendeteVariablen(text: string): string[] {
  const namen = new Set<string>();
  for (const m of text.matchAll(PLATZHALTER_MUSTER)) namen.add(m[1].toLowerCase());
  return [...namen];
}

export type VorlagenPruefung = {
  /** Blockierend: unbalancierte Klammern */
  fehler: string[];
  /** Nur Hinweis: unbekannte Platzhalter */
  unbekannt: string[];
};

/** Prüft Betreff/Text: Klammern (Fehler) und unbekannte Platzhalter (Warnung). */
export function pruefeVorlage(text: string, bekannt: readonly string[]): VorlagenPruefung {
  const ok = new Set(bekannt.map((b) => b.toLowerCase()));
  return {
    fehler: pruefeKlammern(text),
    unbekannt: verwendeteVariablen(text).filter((v) => !ok.has(v)),
  };
}
