// Zweiter Termin-Button auf der Video-Seite: erscheint, sobald das Video zur Hälfte gesehen wurde (oder zu Ende ist),
// direkt beim Video statt erst darunter. Der Klick wird als cta_click mit meta.ort erfasst, damit die Analyse zeigt,
// welche Platzierung Termine bringt.

export const ZWEITER_CTA_AB = 0.5;

export type CtaOrt = 'unten' | 'video_50';

export function zeigeZweitenCta(anteil: number, beendet = false): boolean {
  return beendet || (Number.isFinite(anteil) && anteil >= ZWEITER_CTA_AB);
}

export function ctaOrtAusMeta(meta: unknown): CtaOrt {
  const ort = (meta as { ort?: unknown } | null | undefined)?.ort;
  return ort === 'video_50' ? 'video_50' : 'unten';
}
