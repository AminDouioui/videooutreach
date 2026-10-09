import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-analyse-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
  SENDER_EMAIL: 'amin@prozessia.de',
});

type A = typeof import('./analyse');
type Lead = import('./analyse').AnalyseLead;
let a: A;
let dbm: typeof import('./db');
let rec: typeof import('./tracking');

beforeAll(async () => {
  a = await import('./analyse');
  dbm = await import('./db');
  rec = await import('./tracking');
  dbm.getDb();
});

const lead = (id: number, extra: Partial<Lead> = {}): Lead => ({
  id,
  mitVideo: true,
  sendStatus: 'gesendet',
  flowStopp: null,
  unsubscribed: false,
  leadStatus: 'offen',
  antwortAt: null,
  flowStoppAt: null,
  ...extra,
});
const ev = (leadId: number, type: string, ts = 0) => ({ leadId, type, ts });

describe('Trichter', () => {
  it('zählt Stufen, Raten, Bounces, Abmeldungen und Status', () => {
    const leads = [
      lead(1, { antwortAt: 10, flowStopp: 'beantwortet', leadStatus: 'interessiert' }),
      lead(2, { flowStopp: 'bounce' }),
      lead(3, { unsubscribed: true }),
      lead(4),
      lead(5, { sendStatus: 'nicht_gesendet' }),
    ];
    const events = [ev(1, 'page_view'), ev(1, 'play'), ev(1, 'progress_100'), ev(1, 'cta_click'), ev(3, 'page_view'), ev(3, 'play'), ev(3, 'progress_75'), ev(5, 'page_view')];
    const t = a.aggregiereTrichter(leads, events);
    const n = (k: string) => t.stufen.find((s) => s.key === k)!;
    expect(n('leads').anzahl).toBe(5);
    expect(n('gesendet')).toMatchObject({ anzahl: 4, rate: 1 });
    // Lead 5 ist nicht gesendet und zählt nicht mit
    expect(n('angesehen')).toMatchObject({ anzahl: 2, rate: 0.5 });
    expect(n('play').anzahl).toBe(2);
    expect(n('p50').anzahl).toBe(2); // 75 % und 100 % zählen für 50 %
    expect(n('p100').anzahl).toBe(1);
    expect(n('termin')).toMatchObject({ anzahl: 1, rate: 0.25 });
    expect(n('antwort')).toMatchObject({ anzahl: 1, rate: 0.25 });
    expect(t).toMatchObject({ bounces: 1, abmeldungen: 1, bounceRate: 0.25, abmeldeRate: 0.25 });
    expect(t.statusVerteilung.find((s) => s.status === 'interessiert')?.anzahl).toBe(1);
    expect(t.statusVerteilung.find((s) => s.status === 'offen')?.anzahl).toBe(4);
  });

  it('liefert 0 statt NaN ohne Versand und ignoriert Video-Stufen von Text-Kampagnen', () => {
    const t = a.aggregiereTrichter([lead(1, { sendStatus: 'nicht_gesendet' })], []);
    expect(t.stufen.every((s) => s.rate === null || s.rate === 0)).toBe(true);
    const text = a.aggregiereTrichter([lead(1, { mitVideo: false })], [ev(1, 'page_view')]);
    expect(text.stufen.find((s) => s.key === 'angesehen')?.anzahl).toBe(0);
    expect(text.videoGesendet).toBe(0);
  });
});

describe('Schritt-Zuordnung', () => {
  const v = (leadId: number, step: number, sentAt: number): VersandZeile => ({ leadId, step, sentAt });
  type VersandZeile = import('./analyse').VersandZeile;

  it('ordnet die Antwort dem letzten Schritt vor der Antwort zu', () => {
    const leads = [lead(1, { antwortAt: 250, flowStopp: 'beantwortet' }), lead(2, { antwortAt: 120, flowStopp: 'beantwortet' }), lead(3)];
    const versand = [v(1, 0, 100), v(1, 1, 200), v(1, 2, 300), v(2, 0, 100), v(2, 1, 200), v(3, 0, 100), v(3, 1, 200)];
    const s = a.aggregiereSchritte(leads, versand);
    expect(s.map((x) => [x.label, x.gesendet, x.antworten])).toEqual([
      ['Erstmail', 3, 1],
      ['Follow-up 1', 3, 1],
      ['Follow-up 2', 1, 0],
    ]);
    expect(s[0].antwortRate).toBeCloseTo(1 / 3);
  });

  it('Antwort vor allen Mails und fehlende Mails; Mindestschritte füllen auf', () => {
    const s = a.aggregiereSchritte([lead(1, { antwortAt: 50, flowStopp: 'beantwortet' }), lead(2, { flowStopp: 'beantwortet' })], [v(1, 0, 100), v(2, 0, 100), v(2, 1, 200)], 3);
    expect(s).toHaveLength(3);
    // Lead 2: Antwortzeit unbekannt -> erster gesendeter Schritt
    expect(s[0]).toMatchObject({ gesendet: 2, antworten: 2 });
    expect(s[2]).toMatchObject({ gesendet: 0, antwortRate: 0 });
  });

  it('Rückfall auf flowStoppAt bei älteren Antworten', () => {
    expect(a.antwortZeit(lead(1, { flowStopp: 'beantwortet', flowStoppAt: 77 }))).toBe(77);
    expect(a.antwortZeit(lead(1, { flowStopp: 'bounce', flowStoppAt: 77 }))).toBeNull();
  });
});

describe('Tagesbuckets', () => {
  it('liefert lückenlose Berliner Tage, auch über die Zeitumstellung', () => {
    const tage = a.letzteTage(3, new Date('2026-03-30T10:00:00Z'));
    expect(tage).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
    expect(a.datumPlus('2026-03-01', -1)).toBe('2026-02-28');
    expect(a.letzteTage(30, new Date('2026-10-26T00:30:00Z'))).toHaveLength(new Set(a.letzteTage(30, new Date('2026-10-26T00:30:00Z'))).size);
  });

  it('ordnet nach Berliner Tag zu (23:30 UTC = nächster Tag)', () => {
    const tage = ['2026-07-14', '2026-07-15', '2026-07-16'];
    const p = a.aggregiereTage(tage, {
      gesendet: [Date.parse('2026-07-14T23:30:00Z'), Date.parse('2026-07-15T09:00:00Z'), Date.parse('2026-07-01T09:00:00Z')],
      angesehen: [Date.parse('2026-07-16T08:00:00Z')],
      antworten: [Date.parse('2026-07-14T10:00:00Z')],
    });
    expect(p.map((x) => x.gesendet)).toEqual([0, 2, 0]);
    expect(p.map((x) => x.angesehen)).toEqual([0, 0, 1]);
    expect(p.map((x) => x.antworten)).toEqual([1, 0, 0]);
  });
});

describe('Datenbank', () => {
  it('ladeKampagnenAnalyse und ladeUebersicht aggregieren ohne Bots und trennen Kampagnen', () => {
    const { getDb, schema } = dbm;
    const db = getDb();
    const jetzt = new Date('2026-07-15T12:00:00Z');
    const mk = (name: string, mitVideo: boolean) =>
      db.insert(schema.campaigns).values({ name, ctaUrl: 'https://x.de', emailSubjectTemplate: 's', emailBodyTemplate: 'b', mitVideo }).returning().get();
    const k1 = mk('Video', true);
    const k2 = mk('Text', false);
    const mkLead = (campaignId: number, i: number, extra: Partial<typeof schema.leads.$inferInsert> = {}) =>
      db.insert(schema.leads).values({ campaignId, firma: `F${campaignId}${i}`, email: `a${campaignId}${i}@k.de`, slug: `an-${campaignId}-${i}`, sendStatus: 'gesendet', ...extra }).returning().get();
    const l1 = mkLead(k1.id, 1, { flowStopp: 'beantwortet', antwortAt: new Date('2026-07-15T10:00:00Z') });
    const l2 = mkLead(k1.id, 2);
    const l3 = mkLead(k2.id, 1, { flowStopp: 'beantwortet', antwortAt: new Date('2026-07-14T10:00:00Z'), antwortGelesen: false });
    const sm = (lead: { id: number }, campaignId: number, step: number, at: string) =>
      db.insert(schema.sentMessages).values({ leadId: lead.id, campaignId, step, sentAt: new Date(at) }).run();
    sm(l1, k1.id, 0, '2026-07-14T08:00:00Z');
    sm(l1, k1.id, 1, '2026-07-15T08:00:00Z');
    sm(l2, k1.id, 0, '2026-07-15T08:30:00Z');
    sm(l3, k2.id, 0, '2026-07-14T08:00:00Z');
    const ereignis = (leadId: number, type: 'page_view' | 'play' | 'cta_click', isBot: boolean, at: string) =>
      db.insert(schema.events).values({ leadId, type, isBot, createdAt: new Date(at) }).run();
    ereignis(l1.id, 'page_view', false, '2026-07-15T09:00:00Z');
    ereignis(l1.id, 'page_view', false, '2026-07-15T09:05:00Z');
    ereignis(l2.id, 'page_view', true, '2026-07-15T09:00:00Z'); // Bot
    ereignis(l1.id, 'cta_click', false, '2026-07-15T09:10:00Z');
    rec.aktualisiereScore(l1.id);

    const an = a.ladeKampagnenAnalyse(k1.id, 2, jetzt);
    const n = (k: string) => an.trichter.stufen.find((s) => s.key === k)!;
    expect(n('gesendet').anzahl).toBe(2);
    expect(n('angesehen')).toMatchObject({ anzahl: 1, rate: 0.5 });
    expect(n('termin').anzahl).toBe(1);
    expect(n('antwort').anzahl).toBe(1);
    // Antwort um 10:00 nach Follow-up 1 (08:00)
    expect(an.schritte.map((s) => [s.gesendet, s.antworten])).toEqual([
      [2, 0],
      [1, 1],
    ]);
    expect(an.tage).toHaveLength(30);
    const tag = (d: string) => an.tage.find((t) => t.datum === d)!;
    expect(tag('2026-07-15')).toMatchObject({ gesendet: 2, angesehen: 1, antworten: 1 });
    expect(tag('2026-07-14')).toMatchObject({ gesendet: 1, angesehen: 0, antworten: 0 });

    const u = a.ladeUebersicht(jetzt);
    expect(u.kennzahlen).toMatchObject({ gesendetGesamt: 4, gesendetHeute: 2, gesendet7Tage: 4, erstmails: 3, antworten: 2 });
    expect(u.kennzahlen.antwortRate).toBeCloseTo(2 / 3);
    // Video-Basis nur Kampagne 1 (2 gesendet)
    expect(u.kennzahlen.angesehenRate).toBeCloseTo(0.5);
    expect(u.ungelesen).toBe(2);
    expect(u.tage).toHaveLength(14);

    const text = a.ladeKampagnenAnalyse(k2.id);
    expect(text.trichter.stufen.find((s) => s.key === 'angesehen')?.anzahl).toBe(0);
    expect(text.trichter.antworten).toBe(1);
  });
});
