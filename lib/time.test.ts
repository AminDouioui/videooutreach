import { describe, expect, it } from 'vitest';
import { berlinTeile, formatSendDays, istGueltigeZeitzone, kanonischeZeitzone, leadZeitzone, ortszeit, zeitzoneOderStandard, zonenTeile, isInRenderWindow, isWeekday, isWithinWindow, parseSendDays, startOfDayBerlinMs, todayBerlin } from './time';

const fenster = { sendWindowStart: '08:00', sendWindowEnd: '17:00', sendDays: '1,2,3,4,5' };

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
  it('Wochenende wird ohne Sa/So in sendDays ausgeschlossen', () => {
    const sa = new Date('2026-07-18T09:00:00Z');
    expect(isWeekday(sa)).toBe(false);
    expect(isWithinWindow(fenster, sa)).toBe(false);
    expect(isWithinWindow({ ...fenster, sendDays: '1,2,3,4,5,6,7' }, sa)).toBe(true);
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
  it('freie Versandtage: nur Samstag erlaubt', () => {
    const sa = new Date('2026-07-18T09:00:00Z');
    const mi = new Date('2026-07-15T09:00:00Z');
    expect(isWithinWindow({ ...fenster, sendDays: '6' }, sa)).toBe(true);
    expect(isWithinWindow({ ...fenster, sendDays: '6' }, mi)).toBe(false);
  });
  it('leere Versandtage sperren alles', () => {
    expect(isWithinWindow({ ...fenster, sendDays: '' }, new Date('2026-07-15T09:00:00Z'))).toBe(false);
  });
  it('parseSendDays/formatSendDays: bereinigen und sortieren', () => {
    expect(parseSendDays('5, 1,1,x,8,0,7')).toEqual([1, 5, 7]);
    expect(parseSendDays(null)).toEqual([]);
    expect(formatSendDays([5, 3, 3, 9])).toBe('3,5');
  });
});

describe('Zeitzonen', () => {
  it('Teile für beliebige Zonen; berlinTeile bleibt Wrapper', () => {
    const t = new Date('2026-07-15T12:05:00Z');
    expect(zonenTeile('Europe/London', t)).toEqual({ datum: '2026-07-15', stunde: 13, minute: 5, wochentag: 3 });
    expect(zonenTeile('America/New_York', t)).toMatchObject({ stunde: 8, minute: 5 });
    expect(zonenTeile('Asia/Tokyo', t)).toMatchObject({ stunde: 21 });
    expect(zonenTeile('Europe/Berlin', t)).toEqual(berlinTeile(t));
  });
  it('Datum und Wochentag wechseln mit der Zone', () => {
    const t = new Date('2026-07-15T23:30:00Z'); // Mittwoch
    expect(zonenTeile('Australia/Sydney', t)).toMatchObject({ datum: '2026-07-16', wochentag: 4, stunde: 9 });
    expect(zonenTeile('America/Los_Angeles', t)).toMatchObject({ datum: '2026-07-15', wochentag: 3, stunde: 16 });
  });
  it('ungültige Zone fällt auf Europe/Berlin zurück', () => {
    const t = new Date('2026-07-15T12:00:00Z');
    expect(zonenTeile('Mars/Olympus', t)).toEqual(berlinTeile(t));
    expect(zeitzoneOderStandard('Mars/Olympus')).toBe('Europe/Berlin');
    expect(zeitzoneOderStandard(null)).toBe('Europe/Berlin');
    expect(istGueltigeZeitzone('Mars/Olympus')).toBe(false);
    expect(istGueltigeZeitzone('')).toBe(false);
    expect(istGueltigeZeitzone('America/New_York')).toBe(true);
    expect(kanonischeZeitzone('europe/london')).toBe('Europe/London');
  });
  it('leadZeitzone: Lead vor Kampagne vor Standard', () => {
    expect(leadZeitzone({ zeitzone: 'Asia/Tokyo' }, { zeitzone: 'Europe/London' })).toBe('Asia/Tokyo');
    expect(leadZeitzone({ zeitzone: null }, { zeitzone: 'Europe/London' })).toBe('Europe/London');
    expect(leadZeitzone({ zeitzone: 'Quatsch' }, { zeitzone: 'Europe/London' })).toBe('Europe/London');
    expect(leadZeitzone({}, {})).toBe('Europe/Berlin');
  });
  it('ortszeit formatiert HH:MM', () => {
    expect(ortszeit('Europe/London', new Date('2026-07-15T13:05:00Z'))).toBe('14:05');
  });
  it('Fenster in anderer Zone: 08:00-17:00 in New York (Sommer UTC-4)', () => {
    const k = { ...fenster, zeitzone: 'America/New_York' };
    expect(isWithinWindow(k, new Date('2026-07-15T11:59:00Z'))).toBe(false); // 07:59
    expect(isWithinWindow(k, new Date('2026-07-15T12:00:00Z'))).toBe(true); // 08:00
    expect(isWithinWindow(k, new Date('2026-07-15T20:59:00Z'))).toBe(true); // 16:59
    expect(isWithinWindow(k, new Date('2026-07-15T21:00:00Z'))).toBe(false); // 17:00
    // Zone als Argument überschreibt die der Kampagne
    expect(isWithinWindow(k, new Date('2026-07-15T06:00:00Z'), 'Europe/Berlin')).toBe(true);
  });
  it('Versandtage gelten in der Zone des Leads (Freitag Abend Berlin = Freitag Mittag New York, Samstag in Tokyo)', () => {
    const t = new Date('2026-07-17T16:00:00Z'); // Fr 18:00 Berlin, Fr 12:00 NY, Sa 01:00 Tokyo
    expect(isWithinWindow(fenster, t, 'America/New_York')).toBe(true);
    expect(isWithinWindow(fenster, t, 'Europe/Berlin')).toBe(false); // nach 17:00
    const nachtTokyo = { ...fenster, sendWindowStart: '00:00', sendWindowEnd: '06:00' };
    expect(isWithinWindow(nachtTokyo, t, 'Asia/Tokyo')).toBe(false); // Samstag
    expect(isWithinWindow(nachtTokyo, new Date('2026-07-16T16:00:00Z'), 'Asia/Tokyo')).toBe(true); // Freitag 01:00
  });
  it('Sommerzeitwechsel: Europe/London 08:00 vor und nach der Umstellung (29.03.2026)', () => {
    const k = { ...fenster, zeitzone: 'Europe/London' };
    // Sa 28.03. noch Winterzeit (UTC), Mo 30.03. Sommerzeit (UTC+1)
    expect(isWithinWindow(k, new Date('2026-03-27T08:00:00Z'))).toBe(true); // Fr 08:00 GMT
    expect(isWithinWindow(k, new Date('2026-03-27T07:59:00Z'))).toBe(false);
    expect(isWithinWindow(k, new Date('2026-03-30T06:59:00Z'))).toBe(false); // Mo 07:59 BST
    expect(isWithinWindow(k, new Date('2026-03-30T07:00:00Z'))).toBe(true); // Mo 08:00 BST
  });
  it('Sommerzeitwechsel: New York wechselt früher als Europa (08.03.2026)', () => {
    const k = { ...fenster, zeitzone: 'America/New_York' };
    // Fr 06.03. UTC-5: 08:00 = 13:00 UTC; Mo 09.03. UTC-4: 08:00 = 12:00 UTC
    expect(isWithinWindow(k, new Date('2026-03-06T13:00:00Z'))).toBe(true);
    expect(isWithinWindow(k, new Date('2026-03-06T12:59:00Z'))).toBe(false);
    expect(isWithinWindow(k, new Date('2026-03-09T12:00:00Z'))).toBe(true);
    expect(isWithinWindow(k, new Date('2026-03-09T11:59:00Z'))).toBe(false);
  });
  it('ohne zeitzone gilt weiterhin Berlin', () => {
    expect(isWithinWindow(fenster, new Date('2026-07-15T06:00:00Z'))).toBe(true);
  });
});
