import { describe, expect, it } from 'vitest';
import { aggregierePipeline, dealWertEingabe, formatEuro, inPipeline, parseDealWert, tageImStatus, type PipelineLead } from './pipeline';

const cent = (s: string | number | null) => {
  const r = parseDealWert(s);
  return r.ok ? r.cent : 'ungueltig';
};

describe('parseDealWert', () => {
  it('liest deutsche Schreibweise', () => {
    expect(cent('1.234,50 €')).toBe(123450);
    expect(cent('€ 1.234,5')).toBe(123450);
    expect(cent('1234,50')).toBe(123450);
    expect(cent('2.000')).toBe(200000);
    expect(cent('1.234.567,89 EUR')).toBe(123456789);
    expect(cent('0,99')).toBe(99);
    expect(cent('500')).toBe(50000);
  });
  it('liest englische/Punkt-Schreibweise', () => {
    expect(cent('1234.50')).toBe(123450);
    expect(cent('1,234.50')).toBe(123450);
    expect(cent('12.5')).toBe(1250);
  });
  it('leer = kein Wert, Zahl = Euro', () => {
    expect(cent('')).toBeNull();
    expect(cent('   ')).toBeNull();
    expect(cent(null)).toBeNull();
    expect(cent(1234.5)).toBe(123450);
  });
  it('lehnt Ungültiges ab', () => {
    for (const s of ['abc', '-5', '1,234', '12,345', '1,2,3x', '1e5', '99999999999999']) expect(cent(s), s).toBe('ungueltig');
    expect(cent(-1)).toBe('ungueltig');
    expect(cent(Number.NaN)).toBe('ungueltig');
  });
});

describe('Euro-Format', () => {
  it('de-DE', () => {
    expect(formatEuro(123450).replace(/\s/g, ' ')).toBe('1.234,50 €');
    expect(formatEuro(0).replace(/\s/g, ' ')).toBe('0,00 €');
    expect(formatEuro(null)).toBe('–');
    expect(dealWertEingabe(123450)).toBe('1234,50');
    expect(dealWertEingabe(null)).toBe('');
    expect(cent(dealWertEingabe(123450))).toBe(123450);
  });
});

const T = (tag: number) => new Date(`2026-07-${String(tag).padStart(2, '0')}T10:00:00Z`);
function lead(id: number, extra: Partial<PipelineLead> = {}): PipelineLead {
  return { id, campaignId: 1, leadStatus: 'offen', leadStatusAt: null, flowStopp: null, dealWert: null, ...extra };
}

describe('aggregierePipeline', () => {
  const leads: PipelineLead[] = [
    lead(1), // offen ohne Antwort: nicht in der Pipeline
    lead(2, { flowStopp: 'beantwortet', antwortAt: T(1) }), // offen mit Antwort
    lead(3, { leadStatus: 'interessiert', leadStatusAt: T(5), dealWert: 100000 }),
    lead(4, { leadStatus: 'interessiert', leadStatusAt: T(8), dealWert: 50050, campaignId: 2 }),
    lead(5, { leadStatus: 'interessiert', leadStatusAt: T(2) }),
    lead(6, { leadStatus: 'gewonnen', leadStatusAt: T(3), dealWert: 250000, flowStopp: 'status' }),
  ];

  it('bildet alle Status als Spalten in fester Reihenfolge', () => {
    const s = aggregierePipeline(leads);
    expect(s.map((x) => x.status)).toEqual(['offen', 'interessiert', 'termin_gebucht', 'spaeter', 'nicht_interessiert', 'falscher_ansprechpartner', 'gewonnen', 'verloren']);
  });
  it('nimmt nur Leads mit Antwort oder Status ≠ offen', () => {
    const s = aggregierePipeline(leads);
    expect(s.flatMap((x) => x.leads.map((l) => l.id)).sort()).toEqual([2, 3, 4, 5, 6]);
    expect(inPipeline(leads[0])).toBe(false);
    expect(inPipeline(leads[1])).toBe(true);
  });
  it('summiert Deal-Wert und zählt je Spalte; neueste Wechsel zuerst', () => {
    const s = aggregierePipeline(leads);
    const int = s.find((x) => x.status === 'interessiert')!;
    expect(int.anzahl).toBe(3);
    expect(int.summeCent).toBe(150050);
    expect(int.leads.map((l) => l.id)).toEqual([4, 3, 5]);
    expect(s.find((x) => x.status === 'gewonnen')!.summeCent).toBe(250000);
    expect(s.find((x) => x.status === 'offen')!.anzahl).toBe(1);
    expect(s.find((x) => x.status === 'verloren')).toMatchObject({ anzahl: 0, summeCent: 0 });
  });
  it('filtert nach Kampagne', () => {
    const s = aggregierePipeline(leads, { campaignId: 2 });
    expect(s.flatMap((x) => x.leads.map((l) => l.id))).toEqual([4]);
    expect(s.find((x) => x.status === 'interessiert')!.summeCent).toBe(50050);
  });
});

describe('tageImStatus', () => {
  it('zählt volle Tage; Fallback auf Antwortzeit; sonst null', () => {
    expect(tageImStatus({ leadStatusAt: T(5), antwortAt: null, flowStoppAt: null }, T(8))).toBe(3);
    expect(tageImStatus({ leadStatusAt: null, antwortAt: T(1), flowStoppAt: null }, T(2))).toBe(1);
    expect(tageImStatus({ leadStatusAt: T(9), antwortAt: null, flowStoppAt: null }, T(8))).toBe(0);
    expect(tageImStatus({ leadStatusAt: null, antwortAt: null, flowStoppAt: null }, T(8))).toBeNull();
    expect(tageImStatus({ leadStatusAt: T(5).getTime(), antwortAt: null, flowStoppAt: null }, T(5))).toBe(0);
  });
});
