import { describe, expect, it } from 'vitest';
import { blockiertDurch, postfachLimit, postfachStatus, waehlePostfach, type PostfachZustand } from './rotation';

const HEUTE = '2026-07-15';
const JETZT = Date.parse('2026-07-15T09:00:00Z');

const p = (id: number, extra: Partial<PostfachZustand> = {}): PostfachZustand => ({
  id,
  aktiv: true,
  verbunden: true,
  fehler: null,
  quotaGestopptAm: null,
  nextSendAt: null,
  limit: 30,
  heuteGesendet: 0,
  ...extra,
});

describe('blockiertDurch', () => {
  it('bereites Postfach ist nicht blockiert', () => {
    expect(blockiertDurch(p(1), JETZT, HEUTE)).toBeNull();
  });
  it('liefert den jeweiligen Grund', () => {
    expect(blockiertDurch(p(1, { aktiv: false }), JETZT, HEUTE)).toBe('inaktiv');
    expect(blockiertDurch(p(1, { verbunden: false }), JETZT, HEUTE)).toBe('nicht_verbunden');
    expect(blockiertDurch(p(1, { fehler: 'invalid_grant' }), JETZT, HEUTE)).toBe('fehler');
    expect(blockiertDurch(p(1, { quotaGestopptAm: HEUTE }), JETZT, HEUTE)).toBe('quota_gestoppt');
    expect(blockiertDurch(p(1, { heuteGesendet: 30 }), JETZT, HEUTE)).toBe('limit_postfach');
    expect(blockiertDurch(p(1, { nextSendAt: JETZT + 1 }), JETZT, HEUTE)).toBe('abstand');
  });
  it('Quota-Stopp von gestern gilt nicht mehr; Abstand genau erreicht ist frei', () => {
    expect(blockiertDurch(p(1, { quotaGestopptAm: '2026-07-14' }), JETZT, HEUTE)).toBeNull();
    expect(blockiertDurch(p(1, { nextSendAt: JETZT }), JETZT, HEUTE)).toBeNull();
  });
  it('abstandIgnorieren überspringt nur den Abstand', () => {
    expect(blockiertDurch(p(1, { nextSendAt: JETZT + 5000 }), JETZT, HEUTE, { abstandIgnorieren: true })).toBeNull();
    expect(blockiertDurch(p(1, { heuteGesendet: 30 }), JETZT, HEUTE, { abstandIgnorieren: true })).toBe('limit_postfach');
  });
});

describe('waehlePostfach', () => {
  it('nimmt das Postfach mit den wenigsten heutigen Mails, Gleichstand nach ID', () => {
    expect(waehlePostfach([p(1, { heuteGesendet: 3 }), p(2, { heuteGesendet: 1 }), p(3, { heuteGesendet: 2 })], JETZT, HEUTE)).toEqual({ art: 'gewaehlt', id: 2 });
    expect(waehlePostfach([p(5), p(2), p(9)], JETZT, HEUTE)).toEqual({ art: 'gewaehlt', id: 2 });
  });
  it('überspringt blockierte Postfächer', () => {
    const r = waehlePostfach([p(1, { nextSendAt: JETZT + 60_000 }), p(2, { heuteGesendet: 10 }), p(3, { quotaGestopptAm: HEUTE })], JETZT, HEUTE);
    expect(r).toEqual({ art: 'gewaehlt', id: 2 });
  });
  it('wechselt reihum, wenn nach jedem Versand der Zähler steigt', () => {
    const ps = [p(1), p(2), p(3)];
    const folge: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = waehlePostfach(ps, JETZT, HEUTE);
      if (a.art !== 'gewaehlt') throw new Error('erwartet');
      folge.push(a.id);
      ps.find((x) => x.id === a.id)!.heuteGesendet++;
    }
    expect(folge).toEqual([1, 2, 3, 1, 2, 3]);
  });
  it('wartet mit Grund; Abstand hat Vorrang vor Limit vor Quota vor Fehler', () => {
    expect(waehlePostfach([], JETZT, HEUTE)).toEqual({ art: 'warten', grund: 'kein_postfach' });
    expect(waehlePostfach([p(1, { aktiv: false }), p(2, { verbunden: false })], JETZT, HEUTE)).toEqual({ art: 'warten', grund: 'kein_postfach' });
    expect(waehlePostfach([p(1, { fehler: 'x' })], JETZT, HEUTE)).toEqual({ art: 'warten', grund: 'postfach_fehler' });
    expect(waehlePostfach([p(1, { fehler: 'x' }), p(2, { quotaGestopptAm: HEUTE })], JETZT, HEUTE)).toEqual({ art: 'warten', grund: 'quota_gestoppt' });
    expect(waehlePostfach([p(1, { quotaGestopptAm: HEUTE }), p(2, { heuteGesendet: 30 })], JETZT, HEUTE)).toEqual({ art: 'warten', grund: 'limit_postfach' });
    expect(waehlePostfach([p(1, { heuteGesendet: 30 }), p(2, { nextSendAt: JETZT + 1 })], JETZT, HEUTE)).toEqual({ art: 'warten', grund: 'abstand' });
  });
  it('Limit je Postfach: ein volles Postfach nimmt nichts mehr, das andere übernimmt', () => {
    const r = waehlePostfach([p(1, { limit: 2, heuteGesendet: 2 }), p(2, { limit: 5, heuteGesendet: 4 })], JETZT, HEUTE);
    expect(r).toEqual({ art: 'gewaehlt', id: 2 });
  });
});

describe('postfachLimit', () => {
  const rampe = { aktiv: true, start: 5, schritt: 5 };
  it('ohne Rampe das Tageslimit', () => {
    expect(postfachLimit({ tageslimit: 30, rampe: { ...rampe, aktiv: false }, beginn: HEUTE, heute: HEUTE })).toBe(30);
  });
  it('mit Rampe min(Tageslimit, Start + Schritt * Tage)', () => {
    expect(postfachLimit({ tageslimit: 30, rampe, beginn: '2026-07-15', heute: '2026-07-15' })).toBe(5);
    expect(postfachLimit({ tageslimit: 30, rampe, beginn: '2026-07-10', heute: '2026-07-15' })).toBe(30);
    expect(postfachLimit({ tageslimit: 12, rampe, beginn: '2026-07-10', heute: '2026-07-15' })).toBe(12);
  });
});

describe('postfachStatus', () => {
  const basis = { aktiv: true, verbunden: true, fehler: null, quotaGestopptAm: null };
  it('ordnet den Anzeigestatus zu', () => {
    expect(postfachStatus(basis, HEUTE)).toBe('aktiv');
    expect(postfachStatus({ ...basis, aktiv: false }, HEUTE)).toBe('pausiert');
    expect(postfachStatus({ ...basis, fehler: 'x' }, HEUTE)).toBe('fehler');
    expect(postfachStatus({ ...basis, verbunden: false, aktiv: false }, HEUTE)).toBe('getrennt');
    expect(postfachStatus({ ...basis, quotaGestopptAm: HEUTE }, HEUTE)).toBe('heute_gestoppt');
    expect(postfachStatus({ ...basis, quotaGestopptAm: '2026-07-14' }, HEUTE)).toBe('aktiv');
  });
});
