// Verhaltensstufe eines Leads (rein, ohne DB): was hat der Lead bisher mit Mail und Video gemacht? Grundlage für
// Follow-up-Varianten, die nur zu einem bestimmten Verhalten passen. Es zählen ausschließlich Nicht-Bot-Events.

export const VERHALTEN = ['immer', 'nicht_angesehen', 'angesehen', 'gestartet', 'komplett', 'termin_klick'] as const;
export type Verhalten = (typeof VERHALTEN)[number];
/** Stufen eines Leads (ohne „immer“, das ist nur ein Merkmal von Varianten) */
export type Verhaltensstufe = Exclude<Verhalten, 'immer'>;

export const VERHALTEN_LABEL: Record<Verhalten, string> = {
  immer: 'Immer (jedes Verhalten)',
  nicht_angesehen: 'Video/Link nicht angesehen',
  angesehen: 'Seite geöffnet, Video nicht gestartet',
  gestartet: 'Video gestartet, nicht zu Ende gesehen',
  komplett: 'Video komplett gesehen, kein Termin-Klick',
  termin_klick: 'Termin-Button geklickt, aber nicht gebucht',
};

export function istVerhalten(v: unknown): v is Verhalten {
  return typeof v === 'string' && (VERHALTEN as readonly string[]).includes(v);
}

type Ev = { type: string; isBot: boolean };

/** Höchste erreichte Stufe: Termin-Klick vor komplett vor gestartet vor angesehen vor nichts. */
export function verhaltensstufe(events: Ev[]): Verhaltensstufe {
  const typen = new Set(events.filter((e) => !e.isBot).map((e) => e.type));
  if (typen.has('cta_click')) return 'termin_klick';
  if (typen.has('progress_100')) return 'komplett';
  if (typen.has('play')) return 'gestartet';
  if (typen.has('page_view') || typen.has('link_click') || typen.has('video_link_click')) return 'angesehen';
  return 'nicht_angesehen';
}

export type VarianteMitVerhalten = { kuerzel: string; verhalten?: string | null };

/**
 * Welche Varianten kommen für diese Stufe in Frage? Gibt es aktive Varianten, die genau zur Stufe passen, gewinnen
 * ausschließlich diese (spezifisch schlägt allgemein). Sonst alle mit „immer“. `null` = keine spezifische Variante
 * passt, es gilt die normale Rotation (A plus „immer“-Varianten).
 */
export function passendeVarianten<T extends VarianteMitVerhalten>(aktive: T[], stufe: Verhaltensstufe): T[] | null {
  const spezifisch = aktive.filter((v) => v.verhalten === stufe);
  return spezifisch.length > 0 ? spezifisch : null;
}

/** Variante mit den bisher wenigsten Versendungen (bei Gleichstand nach Kürzel) */
export function wenigsteVersendungen(kuerzel: string[], bisher: Record<string, number>): string {
  const sortiert = [...kuerzel].sort((a, b) => a.localeCompare(b));
  let beste = sortiert[0];
  for (const k of sortiert) if ((bisher[k] ?? 0) < (bisher[beste] ?? 0)) beste = k;
  return beste;
}
