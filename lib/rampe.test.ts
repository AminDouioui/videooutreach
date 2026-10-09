import { describe, expect, it } from 'vitest';
import { rampenLimit, tageSeitBeginn } from './rampe';

const basis = { start: 10, schritt: 5, beginn: '2026-07-01', max: 30 };

describe('rampenLimit', () => {
  it('am ersten Tag gilt der Startwert', () => expect(rampenLimit({ ...basis, heute: '2026-07-01' })).toBe(10));
  it('steigt pro Tag um den Schritt', () => {
    expect(rampenLimit({ ...basis, heute: '2026-07-02' })).toBe(15);
    expect(rampenLimit({ ...basis, heute: '2026-07-03' })).toBe(20);
    expect(rampenLimit({ ...basis, heute: '2026-07-05' })).toBe(30);
  });
  it('wird bei max gedeckelt', () => expect(rampenLimit({ ...basis, heute: '2026-09-01' })).toBe(30));
  it('Startwert über max wird gedeckelt', () => expect(rampenLimit({ ...basis, start: 50, heute: '2026-07-01' })).toBe(30));
  it('ohne oder mit ungültigem Beginn zählt heute als Tag 0', () => {
    expect(rampenLimit({ ...basis, beginn: null, heute: '2026-07-09' })).toBe(10);
    expect(rampenLimit({ ...basis, beginn: 'kaputt', heute: '2026-07-09' })).toBe(10);
  });
  it('Beginn in der Zukunft: Tag 0', () => expect(rampenLimit({ ...basis, beginn: '2026-08-01', heute: '2026-07-09' })).toBe(10));
  it('Schritt 0 hält den Startwert', () => expect(rampenLimit({ ...basis, schritt: 0, heute: '2026-07-20' })).toBe(10));
  it('negative und gebrochene Werte werden bereinigt', () => expect(rampenLimit({ start: -3, schritt: 2.9, beginn: '2026-07-01', heute: '2026-07-03', max: 100 })).toBe(4));
  it('rechnet über Monats- und Sommerzeitgrenzen in ganzen Kalendertagen', () => {
    expect(tageSeitBeginn('2026-03-28', '2026-03-30')).toBe(2);
    expect(tageSeitBeginn('2026-01-30', '2026-02-02')).toBe(3);
  });
});
