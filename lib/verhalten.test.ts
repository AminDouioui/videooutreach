import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { passendeVarianten, verhaltensstufe, VERHALTEN, wenigsteVersendungen } from './verhalten';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-verh-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'r'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
});

const ev = (type: string, isBot = false) => ({ type, isBot });

describe('Verhaltensstufe (rein)', () => {
  it('höchste erreichte Stufe gewinnt', () => {
    expect(verhaltensstufe([])).toBe('nicht_angesehen');
    expect(verhaltensstufe([ev('page_view')])).toBe('angesehen');
    expect(verhaltensstufe([ev('page_view'), ev('play'), ev('progress_50')])).toBe('gestartet');
    expect(verhaltensstufe([ev('play'), ev('progress_100')])).toBe('komplett');
    expect(verhaltensstufe([ev('play'), ev('progress_100'), ev('cta_click')])).toBe('termin_klick');
  });
  it('Bots zählen nicht; ein Link-Klick zählt als angesehen', () => {
    expect(verhaltensstufe([ev('play', true), ev('cta_click', true)])).toBe('nicht_angesehen');
    expect(verhaltensstufe([ev('link_click')])).toBe('angesehen');
  });
  it('passendeVarianten: spezifisch schlägt allgemein, sonst null', () => {
    const v = [{ kuerzel: 'B', verhalten: 'komplett' }, { kuerzel: 'C', verhalten: 'immer' }, { kuerzel: 'D', verhalten: 'komplett' }];
    expect(passendeVarianten(v, 'komplett')?.map((x) => x.kuerzel)).toEqual(['B', 'D']);
    expect(passendeVarianten(v, 'angesehen')).toBeNull();
  });
  it('wenigsteVersendungen rotiert und bricht Gleichstand nach Kürzel', () => {
    expect(wenigsteVersendungen(['B', 'D'], { B: 2, D: 1 })).toBe('D');
    expect(wenigsteVersendungen(['D', 'B'], {})).toBe('B');
  });
  it('Schema-Liste stimmt mit VERHALTEN überein', async () => {
    const { FOLLOWUP_VERHALTEN } = await import('../db/schema');
    expect([...FOLLOWUP_VERHALTEN]).toEqual([...VERHALTEN]);
  });
});

describe('Follow-up nach Verhalten und Heiß-Lead (DB)', () => {
  let db: typeof import('./db');
  let fv: typeof import('./followup-varianten-db');
  let tr: typeof import('./tracking');
  let settings: typeof import('./settings');
  let wh: typeof import('./webhooks');
  let kampagneId = 0;
  let nr = 0;
  beforeAll(async () => {
    db = await import('./db');
    fv = await import('./followup-varianten-db');
    tr = await import('./tracking');
    settings = await import('./settings');
    wh = await import('./webhooks');
    kampagneId = db.getDb().insert(db.schema.campaigns).values({ name: 'V', ctaUrl: 'https://x.de', emailSubjectTemplate: 's', emailBodyTemplate: 'b' }).returning().get().id;
  });
  const neuerLead = () => {
    nr++;
    return db.getDb().insert(db.schema.leads).values({ campaignId: kampagneId, firma: `F${nr}`, email: `l${nr}@f.de`, slug: `verh-${nr}`, sendStatus: 'gesendet' }).returning().get();
  };
  const ereignis = (leadId: number, type: (typeof import('../db/schema').EVENT_TYPEN)[number], isBot = false) => tr.recordEvent({ leadId, type, ipHash: 'h', userAgent: 'ua', isBot });

  it('wählt die Variante, die zum Verhalten des Leads passt, sonst die normale Rotation', () => {
    const { getDb, schema } = db;
    const f = getDb().insert(schema.followups).values({ campaignId: kampagneId, position: 1, waitDays: 3, body: 'Text A' }).returning().get();
    getDb().insert(schema.followupVarianten).values([
      { followupId: f.id, kuerzel: 'B', text: 'Text B komplett', verhalten: 'komplett' },
      { followupId: f.id, kuerzel: 'C', text: 'Text C Termin', verhalten: 'termin_klick' },
      { followupId: f.id, kuerzel: 'D', text: 'Text D inaktiv', verhalten: 'angesehen', aktiv: false },
    ]).run();
    expect(fv.waehleFollowupVariante(f, 1, 'komplett').body).toBe('Text B komplett');
    expect(fv.waehleFollowupVariante(f, 1, 'termin_klick').body).toBe('Text C Termin');
    // keine passende (D ist inaktiv): normale Rotation, B und C haben ein Verhalten, also bleibt A
    expect(fv.waehleFollowupVariante(f, 1, 'angesehen').body).toBe('Text A');
    expect(fv.waehleFollowupVariante(f, 1).body).toBe('Text A');
  });

  it('ladeVerhaltensstufe liest die Events des Leads', () => {
    const l = neuerLead();
    expect(fv.ladeVerhaltensstufe(l.id)).toBe('nicht_angesehen');
    ereignis(l.id, 'page_view');
    ereignis(l.id, 'play');
    expect(fv.ladeVerhaltensstufe(l.id)).toBe('gestartet');
  });

  it('heisser_lead: einmal bei Erreichen der Schwelle, mit Webhook; darunter und für Bots nichts', () => {
    const hook = wh.legeWebhookAn('https://hook.example/h', ['heisser_lead']);
    const zustellungen = () => db.getDb().select().from(db.schema.webhookZustellungen).where(eq(db.schema.webhookZustellungen.webhookId, hook.id)).all();
    const l = neuerLead();
    ereignis(l.id, 'play', true);
    ereignis(l.id, 'cta_click', true);
    ereignis(l.id, 'play'); // 10
    expect(db.getDb().select().from(db.schema.leads).where(eq(db.schema.leads.id, l.id)).get()?.heissAt).toBeNull();
    ereignis(l.id, 'cta_click'); // 40
    const heiss = db.getDb().select().from(db.schema.leads).where(eq(db.schema.leads.id, l.id)).get();
    expect(heiss?.score).toBe(40);
    expect(heiss?.heissAt).not.toBeNull();
    ereignis(l.id, 'progress_100'); // 55, kein zweiter Alarm
    const z = zustellungen();
    expect(z).toHaveLength(1);
    expect(z[0].ereignis).toBe('heisser_lead');
    expect(z[0].payload).toMatchObject({ ereignis: 'heisser_lead', daten: { score: 40 } });
  });

  it('Schwelle ist einstellbar; abgemeldete Leads melden nichts', () => {
    settings.setSetting('heiss_schwelle', '10');
    expect(settings.heissSchwelle()).toBe(10);
    const l = neuerLead();
    db.getDb().update(db.schema.leads).set({ unsubscribed: true }).where(eq(db.schema.leads.id, l.id)).run();
    ereignis(l.id, 'play');
    expect(db.getDb().select().from(db.schema.leads).where(eq(db.schema.leads.id, l.id)).get()?.heissAt).toBeNull();
    const l2 = neuerLead();
    ereignis(l2.id, 'play');
    expect(db.getDb().select().from(db.schema.leads).where(eq(db.schema.leads.id, l2.id)).get()?.heissAt).not.toBeNull();
    settings.deleteSetting('heiss_schwelle');
    expect(settings.heissSchwelle()).toBe(40);
  });
});
