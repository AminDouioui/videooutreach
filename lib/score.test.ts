import { describe, expect, it } from 'vitest';
import { berechneScore } from './score';

const e = (type: string, iso: string, isBot = false) => ({ type, isBot, createdAt: new Date(iso) });

describe('berechneScore', () => {
  it('leer = 0', () => expect(berechneScore([])).toBe(0));
  it('play + 50 % + Klick = 50', () => {
    expect(berechneScore([e('page_view', '2026-01-05T10:00:00Z'), e('play', '2026-01-05T10:00:05Z'), e('progress_25', '2026-01-05T10:00:10Z'), e('progress_50', '2026-01-05T10:00:20Z'), e('cta_click', '2026-01-05T10:01:00Z')])).toBe(50);
  });
  it('alles inkl. 100 % = 65', () => {
    expect(berechneScore([e('play', '2026-01-05T10:00:00Z'), e('progress_50', '2026-01-05T10:00:00Z'), e('progress_100', '2026-01-05T10:00:00Z'), e('cta_click', '2026-01-05T10:00:00Z')])).toBe(65);
  });
  it('Events sind einmalig gezählt', () => {
    expect(berechneScore([e('play', '2026-01-05T10:00:00Z'), e('play', '2026-01-05T10:05:00Z'), e('cta_click', '2026-01-05T10:00:00Z'), e('cta_click', '2026-01-05T10:00:30Z')])).toBe(40);
  });
  it('Bots und email_open zählen nicht', () => {
    expect(berechneScore([e('play', '2026-01-05T10:00:00Z', true), e('page_view', '2026-01-05T10:00:00Z', true), e('email_open', '2026-01-05T10:00:00Z')])).toBe(0);
  });
  it('+5 je weiterem Kalendertag (Berlin)', () => {
    expect(berechneScore([e('page_view', '2026-01-05T10:00:00Z'), e('page_view', '2026-01-06T10:00:00Z'), e('play', '2026-01-08T10:00:00Z')])).toBe(10 + 10);
  });
  it('Tagesgrenze nach Berlin-Zeit: 23:30Z und 00:30Z (Winter) sind derselbe Berliner Tag? nein, zwei', () => {
    // 22:30Z = 23:30 Berlin (5.1.), 23:30Z = 00:30 Berlin (6.1.)
    expect(berechneScore([e('page_view', '2026-01-05T22:30:00Z'), e('page_view', '2026-01-05T23:30:00Z')])).toBe(5);
    // 10:00Z und 12:00Z gleicher Tag
    expect(berechneScore([e('page_view', '2026-01-05T10:00:00Z'), e('page_view', '2026-01-05T12:00:00Z')])).toBe(0);
  });
});
