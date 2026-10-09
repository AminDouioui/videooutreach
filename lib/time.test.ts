import { describe, expect, it } from 'vitest';
import { isInRenderWindow, isWeekday, isWithinWindow, startOfDayBerlinMs, todayBerlin } from './time';

const fenster = { sendWindowStart: '08:00', sendWindowEnd: '17:00', sendWeekdaysOnly: true };

describe('Render-Fenster', () => {
  it('ohne Fenster immer offen', () => {
    expect(isInRenderWindow(undefined, new Date('2026-07-15T12:00:00Z'))).toBe(true);
  });
  it('00:00-07:00 Berlin (Sommer UTC+2)', () => {
    expect(isInRenderWindow('00:00-07:00', new Date('2026-07-14T21:59:00Z'))).toBe(false); // 23:59
    expect(isInRenderWindow('00:00-07:00', new Date('2026-07-14T22:00:00Z'))).toBe(true); // 00:00
    expect(isInRenderWindow('00:00-07:00', new Date('2026-07-15T04:59:00Z'))).toBe(true); // 06:59
    expect(isInRenderWindow('00:00-07:00', new Date('2026-07-15T05:00:00Z'))).toBe(false); // 07:00
  });
  it('über Mitternacht 22:00-06:00', () => {
    expect(isInRenderWindow('22:00-06:00', new Date('2026-07-15T20:30:00Z'))).toBe(true); // 22:30
    expect(isInRenderWindow('22:00-06:00', new Date('2026-07-15T03:00:00Z'))).toBe(true); // 05:00
    expect(isInRenderWindow('22:00-06:00', new Date('2026-07-15T10:00:00Z'))).toBe(false); // 12:00
  });
});

describe('time (Europe/Berlin)', () => {
  it('todayBerlin berücksichtigt Zeitzone (Sommer UTC+2)', () => {
    expect(todayBerlin(new Date('2026-07-15T22:30:00Z'))).toBe('2026-07-16');
    expect(todayBerlin(new Date('2026-07-15T21:59:00Z'))).toBe('2026-07-15');
  });
  it('todayBerlin im Winter (UTC+1)', () => {
    expect(todayBerlin(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
    expect(todayBerlin(new Date('2026-01-15T22:59:00Z'))).toBe('2026-01-15');
  });
  it('Fenster Sommer: 08:00 Berlin = 06:00 UTC', () => {
    const k = fenster;
    expect(isWithinWindow(k, new Date('2026-07-15T05:59:00Z'))).toBe(false);
    expect(isWithinWindow(k, new Date('2026-07-15T06:00:00Z'))).toBe(true);
    expect(isWithinWindow(k, new Date('2026-07-15T14:59:00Z'))).toBe(true);
    expect(isWithinWindow(k, new Date('2026-07-15T15:00:00Z'))).toBe(false);
  });
  it('Fenster Winter: 08:00 Berlin = 07:00 UTC', () => {
    expect(isWithinWindow(fenster, new Date('2026-01-14T06:59:00Z'))).toBe(false);
    expect(isWithinWindow(fenster, new Date('2026-01-14T07:00:00Z'))).toBe(true);
  });
  it('Sommerzeit-Umstellung 2026-03-29: Offset wechselt', () => {
    // Vorabend noch UTC+1, Montag danach UTC+2
    expect(isWithinWindow(fenster, new Date('2026-03-27T07:00:00Z'))).toBe(true); // Fr 08:00 CET
    expect(isWithinWindow(fenster, new Date('2026-03-30T06:00:00Z'))).toBe(true); // Mo 08:00 CEST
    expect(isWithinWindow(fenster, new Date('2026-03-30T05:59:00Z'))).toBe(false);
    expect(todayBerlin(new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-29');
  });
  it('Rückumstellung 2026-10-25', () => {
    expect(isWithinWindow(fenster, new Date('2026-10-26T07:00:00Z'))).toBe(true); // Mo 08:00 CET
    expect(isWithinWindow(fenster, new Date('2026-10-26T06:59:00Z'))).toBe(false);
  });
  it('Wochenende wird bei weekdaysOnly ausgeschlossen', () => {
    const sa = new Date('2026-07-18T09:00:00Z');
    expect(isWeekday(sa)).toBe(false);
    expect(isWithinWindow(fenster, sa)).toBe(false);
    expect(isWithinWindow({ ...fenster, sendWeekdaysOnly: false }, sa)).toBe(true);
  });
  it('ungültiges Fenster ist geschlossen', () => {
    expect(isWithinWindow({ ...fenster, sendWindowStart: 'xx' }, new Date('2026-07-15T09:00:00Z'))).toBe(false);
  });
  it('startOfDayBerlinMs liefert Berliner Mitternacht (Sommer, Winter, Umstelltag)', () => {
    expect(new Date(startOfDayBerlinMs(new Date('2026-07-15T10:00:00Z'))).toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(new Date(startOfDayBerlinMs(new Date('2026-01-15T10:00:00Z'))).toISOString()).toBe('2026-01-14T23:00:00.000Z');
    expect(new Date(startOfDayBerlinMs(new Date('2026-03-29T10:00:00Z'))).toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(new Date(startOfDayBerlinMs(new Date('2026-10-25T10:00:00Z'))).toISOString()).toBe('2026-10-24T22:00:00.000Z');
  });
});
