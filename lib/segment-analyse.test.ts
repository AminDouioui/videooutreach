import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { konterFuer, parseKonterEinstellung, STANDARD_KONTER } from './einwaende';
import { gruppiereNachSegment, rolleAusPosition, segmentFelder, segmentWert, type SegmentLead } from './segment-analyse';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-seg-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'r'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
});

const lead = (id: number, position: string | null, extra: Record<string, unknown> | null, o: Partial<SegmentLead> = {}): SegmentLead => ({
  id, position, extra, gesendet: true, antwort: false, leadStatus: 'offen', angesehen: false, play: false, termin: false, ...o,
});

describe('Rollen und Segmentwerte', () => {
  it('ordnet Positionen groben Rollen zu', () => {
    expect(rolleAusPosition('Geschäftsführer')).toBe('Geschäftsführung');
    expect(rolleAusPosition('Leiter Einkauf')).toBe('Einkauf');
    expect(rolleAusPosition('Head of Sales')).toBe('Vertrieb');
    expect(rolleAusPosition('Arbeitsvorbereitung')).toBe('Produktion und Technik');
    expect(rolleAusPosition('IT-Leiter')).toBe('IT und Digitalisierung');
    expect(rolleAusPosition('Praktikant')).toBe('Sonstige');
    expect(rolleAusPosition('  ')).toBe('Unbekannt');
    expect(rolleAusPosition(null)).toBe('Unbekannt');
  });
  it('segmentWert liest Rolle, Position und eigene Spalten (normalisiert)', () => {
    const l = { position: 'Leiter Einkauf', extra: { 'Branche ': 'Maschinenbau', Größe: '' } };
    expect(segmentWert(l, 'rolle')).toBe('Einkauf');
    expect(segmentWert(l, 'position')).toBe('Leiter Einkauf');
    expect(segmentWert(l, 'branche')).toBe('Maschinenbau');
    expect(segmentWert(l, 'groesse')).toBe('Unbekannt');
    expect(segmentWert(l, 'gibtsnicht')).toBe('Unbekannt');
  });
  it('segmentFelder: Rolle, Position, dann eigene Spalten', () => {
    expect(segmentFelder(['branche']).map((f) => f.key)).toEqual(['rolle', 'position', 'branche']);
  });
});

describe('Gruppierung', () => {
  it('zählt Stufen nur für gesendete Leads und berechnet Raten', () => {
    const z = gruppiereNachSegment(
      [
        lead(1, 'Einkauf', null, { angesehen: true, play: true, termin: true, antwort: true, leadStatus: 'interessiert' }),
        lead(2, 'Einkauf', null, { angesehen: true }),
        lead(3, 'Einkauf', null, { gesendet: false, angesehen: true, antwort: true }),
        lead(4, 'Vertrieb', null, { antwort: true, leadStatus: 'termin_gebucht' }),
      ],
      'rolle',
    );
    const e = z.find((x) => x.segment === 'Einkauf')!;
    expect(e).toMatchObject({ leads: 3, gesendet: 2, angesehen: 2, play: 1, termin: 1, antworten: 1, positiv: 1, antwortRate: 0.5, positivRate: 0.5 });
    expect(z.find((x) => x.segment === 'Vertrieb')).toMatchObject({ gesendet: 1, antwortRate: 1, positiv: 1 });
    expect(z[0].segment).toBe('Einkauf'); // meiste gesendete zuerst
  });
  it('Segment ohne gesendete Mails hat keine Rate', () => {
    expect(gruppiereNachSegment([lead(1, 'Einkauf', null, { gesendet: false })], 'rolle')[0].antwortRate).toBeNull();
  });
  it('fasst mehr als 15 Segmente zu „Weitere“ zusammen, ohne Leads zu verlieren', () => {
    const leads = Array.from({ length: 20 }, (_, i) => lead(i, `Pos ${i}`, null));
    const z = gruppiereNachSegment(leads, 'position');
    expect(z).toHaveLength(15);
    expect(z[14].segment).toBe('Weitere');
    expect(z.reduce((s, x) => s + x.leads, 0)).toBe(20);
  });
});

describe('Konter', () => {
  it('Standard, Überschreibung und kein Konter ohne Einwand', () => {
    expect(konterFuer('kein_budget')).toBe(STANDARD_KONTER.kein_budget);
    expect(konterFuer('kein_budget', { kein_budget: ' Eigener Text ' })).toBe('Eigener Text');
    expect(konterFuer('kein_einwand')).toBeNull();
    expect(konterFuer(null)).toBeNull();
    expect(konterFuer('unbekannt')).toBeNull();
  });
  it('parseKonterEinstellung ignoriert Unbekanntes, Leeres und kaputtes JSON', () => {
    expect(parseKonterEinstellung('{"keine_zeit":" Text ","kein_einwand":"x","foo":"y","kein_bedarf":""}')).toEqual({ keine_zeit: 'Text' });
    expect(parseKonterEinstellung('{kaputt')).toEqual({});
    expect(parseKonterEinstellung(null)).toEqual({});
  });
});

describe('Datenbank: Segmentleads und Einwand-Verteilung', () => {
  let db: typeof import('./db');
  let seg: typeof import('./segment-analyse');
  let kid = 0;
  beforeAll(async () => {
    db = await import('./db');
    seg = await import('./segment-analyse');
    kid = db.getDb().insert(db.schema.campaigns).values({ name: 'S', ctaUrl: 'https://x.de', emailSubjectTemplate: 's', emailBodyTemplate: 'b' }).returning().get().id;
  });
  it('liest Events ohne Bots und zählt Einwände ohne „kein Einwand“', async () => {
    const { getDb, schema } = db;
    const mk = (n: number, extra: Partial<typeof schema.leads.$inferInsert>) => getDb().insert(schema.leads).values({ campaignId: kid, firma: `F${n}`, email: `s${n}@f.de`, slug: `seg-${n}`, sendStatus: 'gesendet', ...extra }).returning().get();
    const a = mk(1, { position: 'Einkauf', kiEinwand: 'keine_zeit' });
    const b = mk(2, { position: 'Einkauf', kiEinwand: 'keine_zeit', flowStopp: 'beantwortet' });
    mk(3, { kiEinwand: 'kein_einwand' });
    mk(4, { kiEinwand: 'kein_budget' });
    getDb().insert(schema.events).values([
      { leadId: a.id, type: 'page_view', isBot: false },
      { leadId: a.id, type: 'cta_click', isBot: true },
      { leadId: b.id, type: 'play', isBot: false },
    ]).run();
    const leads = seg.ladeSegmentLeads(kid);
    expect(leads.find((l) => l.id === a.id)).toMatchObject({ angesehen: true, termin: false, play: false });
    expect(leads.find((l) => l.id === b.id)).toMatchObject({ play: true, antwort: true });
    expect(seg.ladeEinwandVerteilung(kid)).toEqual([
      { einwand: 'keine_zeit', label: 'Keine Zeit', anzahl: 2 },
      { einwand: 'kein_budget', label: 'Kein Budget / zu teuer', anzahl: 1 },
    ]);
  });
  it('ladeCtaOrte trennt Termin-Klicks nach Platzierung und ignoriert Bots', async () => {
    const { getDb, schema } = db;
    const kamp = getDb().insert(schema.campaigns).values({ name: 'C', ctaUrl: 'https://x.de', emailSubjectTemplate: 's', emailBodyTemplate: 'b' }).returning().get().id;
    const l = getDb().insert(schema.leads).values({ campaignId: kamp, firma: 'C1', email: 'c1@f.de', slug: 'cta-1' }).returning().get();
    getDb().insert(schema.events).values([
      { leadId: l.id, type: 'cta_click', isBot: false, meta: { ort: 'video_50' } },
      { leadId: l.id, type: 'cta_click', isBot: false, meta: { ort: 'unten' } },
      { leadId: l.id, type: 'cta_click', isBot: false },
      { leadId: l.id, type: 'cta_click', isBot: true, meta: { ort: 'video_50' } },
    ]).run();
    expect(seg.ladeCtaOrte(kamp)).toEqual({ unten: 2, video_50: 1 });
  });
});
