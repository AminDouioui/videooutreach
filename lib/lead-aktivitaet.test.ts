import { describe, expect, it } from 'vitest';
import { fasseAktivitaetZusammen } from './lead-aktivitaet';
import { kurzZeit } from './kurzzeit';

const e = (type: string, iso: string, isBot = false) => ({ type, isBot, createdAt: new Date(iso) });

describe('fasseAktivitaetZusammen', () => {
  it('leer', () => {
    expect(fasseAktivitaetZusammen([])).toEqual({
      mailKlick: { erster: null, letzter: null, anzahl: 0 },
      play: { erster: null, letzter: null, anzahl: 0 },
      termin: { erster: null, letzter: null, anzahl: 0 },
      maxProgress: 0,
      botEvents: 0,
    });
  });
  it('erste/letzte Zeit und Anzahl ohne Bots, max. Fortschritt', () => {
    const a = fasseAktivitaetZusammen([
      e('video_link_click', '2026-10-13T08:00:00Z', true),
      e('video_link_click', '2026-10-13T09:00:00Z'),
      e('play', '2026-10-13T09:01:00Z'),
      e('progress_25', '2026-10-13T09:02:00Z'),
      e('progress_75', '2026-10-13T09:03:00Z'),
      e('cta_click', '2026-10-13T09:05:00Z'),
      e('cta_click', '2026-10-14T09:05:00Z'),
    ]);
    expect(a.mailKlick).toEqual({ erster: Date.parse('2026-10-13T09:00:00Z'), letzter: Date.parse('2026-10-13T09:00:00Z'), anzahl: 1 });
    expect(a.termin).toEqual({ erster: Date.parse('2026-10-13T09:05:00Z'), letzter: Date.parse('2026-10-14T09:05:00Z'), anzahl: 2 });
    expect(a.maxProgress).toBe(75);
    expect(a.botEvents).toBe(1);
  });
});

describe('kurzZeit', () => {
  it('Europe/Berlin, „13.10. 14:32“', () => {
    expect(kurzZeit(Date.parse('2026-10-13T12:32:00Z'))).toBe('13.10. 14:32');
    expect(kurzZeit(Date.parse('2026-01-05T23:30:00Z'))).toBe('06.01. 00:30');
    expect(kurzZeit(null)).toBe('–');
  });
});
