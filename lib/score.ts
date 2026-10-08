// Lead-Score (rein, ohne DB). Es zählen ausschließlich Nicht-Bot-Events.
//
// Punkte: play +10 (einmalig), progress_50 +10, progress_100 +15, cta_click +30 (einmalig),
// +5 je weiterem Kalendertag (Europe/Berlin) mit page_view/play über den ersten Tag hinaus.
// progress_25/75 geben 0 Punkte; email_open und unsubscribe zählen nicht.

export type ScoreEvent = { type: string; isBot: boolean; createdAt: Date | number };

const TAG = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Kalendertag (YYYY-MM-DD) in Europe/Berlin. */
export function berlinTag(t: Date | number): string {
  return TAG.format(t);
}

export function berechneScore(events: ScoreEvent[]): number {
  const echte = events.filter((e) => !e.isBot);
  const hat = (typ: string) => echte.some((e) => e.type === typ);
  let score = 0;
  if (hat('play')) score += 10;
  if (hat('progress_50')) score += 10;
  if (hat('progress_100')) score += 15;
  if (hat('cta_click')) score += 30;
  const tage = new Set(echte.filter((e) => e.type === 'page_view' || e.type === 'play').map((e) => berlinTag(e.createdAt)));
  if (tage.size > 1) score += 5 * (tage.size - 1);
  return score;
}
