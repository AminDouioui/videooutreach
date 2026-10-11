import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHmac } from 'crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { legePostfachAn, setzePostfaecherZurueck } from './test-postfach';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-webhooks-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
  SENDER_EMAIL: 'amin@prozessia.de',
  SEND_MIN_GAP_MINUTES: '3',
  SEND_MAX_GAP_MINUTES: '9',
});

type Mods = {
  db: typeof import('./db');
  wh: typeof import('./webhooks');
  zu: typeof import('./webhook-zustellung');
  send: typeof import('./send');
  status: typeof import('./lead-status-db');
  tracking: typeof import('./tracking');
  suppression: typeof import('./suppression');
};
let m: Mods;
let nr = 0;
let postfachId = 0;
const T0 = new Date('2026-07-15T09:00:00Z');
const OEFFENTLICH = async () => ['93.184.216.34'];

function kampagne() {
  nr++;
  return m.db.getDb().insert(m.db.schema.campaigns).values({ name: `Kamp ${nr}`, ctaUrl: 'https://x.de', emailSubjectTemplate: 'Hallo {{firma}}', emailBodyTemplate: '{{begruessung}}', mitVideo: false }).returning().get();
}
function lead(campaignId: number, extra: Partial<typeof import('@/db/schema').leads.$inferInsert> = {}) {
  nr++;
  return m.db.getDb().insert(m.db.schema.leads).values({ campaignId, firma: `Firma ${nr}`, vorname: 'Eva', nachname: 'Muster', email: `f${nr}@kunde${nr}.de`, slug: `wh-${nr}`, ...extra }).returning().get();
}
const zustellungen = (webhookId?: number) => {
  const { getDb, schema } = m.db;
  const q = getDb().select().from(schema.webhookZustellungen);
  return (webhookId === undefined ? q.all() : q.where(eq(schema.webhookZustellungen.webhookId, webhookId)).all()).sort((a, b) => a.id - b.id);
};

beforeAll(async () => {
  m = {
    db: await import('./db'),
    wh: await import('./webhooks'),
    zu: await import('./webhook-zustellung'),
    send: await import('./send'),
    status: await import('./lead-status-db'),
    tracking: await import('./tracking'),
    suppression: await import('./suppression'),
  };
  m.db.getDb();
  postfachId = (await legePostfachAn()).id;
});

beforeEach(async () => {
  const { getDb, schema } = m.db;
  getDb().delete(schema.webhooks).run();
  await setzePostfaecherZurueck();
});

describe('Zustellung', () => {
  it('2xx = ok; Header, Signatur und Payload stimmen', async () => {
    const hook = m.wh.legeWebhookAn('https://hooks.example.com/x', ['antwort']);
    const k = kampagne();
    const l = lead(k.id);
    expect(m.wh.webhookAusloesen('antwort', { leadId: l.id })).toBe(1);
    const aufrufe: { url: string; headers: Record<string, string>; body: string }[] = [];
    const n = await m.zu.stelleFaelligeZu({ resolver: OEFFENTLICH, fetchFn: async (url, init) => { aufrufe.push({ url, headers: init.headers, body: init.body }); return { status: 204 }; } });
    expect(n).toBe(1);
    expect(aufrufe).toHaveLength(1);
    const a = aufrufe[0];
    expect(a.url).toBe('https://hooks.example.com/x');
    const z = zustellungen(hook.id)[0];
    expect(z).toMatchObject({ status: 'ok', versuche: 1, httpStatus: 204, letzterFehler: null });
    expect(z.zugestelltAt).not.toBeNull();
    expect(a.headers['X-Ereignis']).toBe('antwort');
    expect(a.headers['X-Zustellung-Id']).toBe(String(z.id));
    expect(a.headers['Content-Type']).toBe('application/json');
    expect(a.headers['X-Signatur']).toBe(`sha256=${createHmac('sha256', m.wh.webhookGeheimnis(hook)).update(a.body).digest('hex')}`);
    const body = JSON.parse(a.body);
    expect(body.ereignis).toBe('antwort');
    expect(typeof body.zeit).toBe('string');
    expect(body.daten.lead).toEqual({ id: l.id, email: l.email, firma: l.firma, vorname: 'Eva', nachname: 'Muster', kampagne: { id: k.id, name: k.name }, leadStatus: 'offen', score: 0 });
  });

  it('Geheimnis wird verschlüsselt gespeichert und lässt sich erneuern', () => {
    const hook = m.wh.legeWebhookAn('https://hooks.example.com/x', ['antwort']);
    const klar = m.wh.webhookGeheimnis(hook);
    expect(hook.geheimnis).not.toContain(klar);
    const neu = m.wh.erneuereGeheimnis(hook.id)!;
    expect(neu).not.toBe(klar);
    expect(m.wh.webhookGeheimnis(m.wh.listeWebhooks()[0])).toBe(neu);
  });

  it('500 → Wiederholung nach 1 min, 5 min, 30 min, 2 h, 12 h, dann fehler', async () => {
    const hook = m.wh.legeWebhookAn('https://hooks.example.com/x', ['bounce']);
    const l = lead(kampagne().id);
    m.wh.webhookAusloesen('bounce', { leadId: l.id }, T0);
    let t = T0;
    const fetchFn = async () => ({ status: 500 });
    const erwartet = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
    for (let i = 0; i < 5; i++) {
      expect(await m.zu.stelleFaelligeZu({ resolver: OEFFENTLICH, fetchFn, jetzt: t })).toBe(1);
      const z = zustellungen(hook.id)[0];
      expect(z).toMatchObject({ status: 'offen', versuche: i + 1, httpStatus: 500, letzterFehler: 'HTTP 500' });
      expect(z.naechsterVersuchAt!.getTime()).toBe(t.getTime() + erwartet[i]);
      // vor Ablauf nichts fällig
      expect(await m.zu.stelleFaelligeZu({ resolver: OEFFENTLICH, fetchFn, jetzt: new Date(t.getTime() + erwartet[i] - 1) })).toBe(0);
      t = new Date(t.getTime() + erwartet[i]);
    }
    expect(await m.zu.stelleFaelligeZu({ resolver: OEFFENTLICH, fetchFn, jetzt: t })).toBe(1);
    expect(zustellungen(hook.id)[0]).toMatchObject({ status: 'fehler', versuche: 6, naechsterVersuchAt: null });
    expect(await m.zu.stelleFaelligeZu({ resolver: OEFFENTLICH, fetchFn, jetzt: new Date(t.getTime() + 1e9) })).toBe(0);
  });

  it('Wiederholung gelingt später', async () => {
    const hook = m.wh.legeWebhookAn('https://hooks.example.com/x', ['bounce']);
    m.wh.webhookAusloesen('bounce', { leadId: lead(kampagne().id).id }, T0);
    await m.zu.stelleFaelligeZu({ resolver: OEFFENTLICH, fetchFn: async () => ({ status: 503 }), jetzt: T0 });
    await m.zu.stelleFaelligeZu({ resolver: OEFFENTLICH, fetchFn: async () => ({ status: 200 }), jetzt: new Date(T0.getTime() + 61_000) });
    expect(zustellungen(hook.id)[0]).toMatchObject({ status: 'ok', versuche: 2, httpStatus: 200, letzterFehler: null });
  });

  it('Zeitüberschreitung bricht ab und wird wiederholt', async () => {
    const hook = m.wh.legeWebhookAn('https://hooks.example.com/x', ['bounce']);
    m.wh.webhookAusloesen('bounce', { leadId: lead(kampagne().id).id }, T0);
    const haengt = (_u: string, init: { signal: AbortSignal }) => new Promise<{ status: number }>((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    await m.zu.stelleFaelligeZu({ resolver: OEFFENTLICH, fetchFn: haengt, jetzt: T0, timeoutMs: 20 });
    const z = zustellungen(hook.id)[0];
    expect(z.status).toBe('offen');
    expect(z.versuche).toBe(1);
    expect(z.letzterFehler).toContain('Zeitüberschreitung');
    expect(z.naechsterVersuchAt!.getTime()).toBe(T0.getTime() + 60_000);
  });

  it('Netzwerkfehler wird protokolliert', async () => {
    const hook = m.wh.legeWebhookAn('https://hooks.example.com/x', ['bounce']);
    m.wh.webhookAusloesen('bounce', { leadId: lead(kampagne().id).id }, T0);
    await m.zu.stelleFaelligeZu({ resolver: OEFFENTLICH, fetchFn: async () => { throw new Error('ECONNREFUSED'); }, jetzt: T0 });
    expect(zustellungen(hook.id)[0].letzterFehler).toContain('ECONNREFUSED');
  });

  it('SSRF: Ziel im privaten Netz wird nicht angefragt und endgültig abgelehnt', async () => {
    const { getDb, schema } = m.db;
    const hook = m.wh.legeWebhookAn('http://169.254.169.254/latest', ['bounce']);
    m.wh.webhookAusloesen('bounce', { leadId: lead(kampagne().id).id }, T0);
    let aufgerufen = false;
    await m.zu.stelleFaelligeZu({ resolver: OEFFENTLICH, privatErlaubt: false, fetchFn: async () => { aufgerufen = true; return { status: 200 }; }, jetzt: T0 });
    expect(aufgerufen).toBe(false);
    const z = zustellungen(hook.id)[0];
    expect(z.status).toBe('fehler');
    expect(z.letzterFehler).toContain('Ziel abgelehnt');
    // mit Erlaubnis geht es raus
    getDb().update(schema.webhookZustellungen).set({ status: 'offen', naechsterVersuchAt: T0 }).run();
    await m.zu.stelleFaelligeZu({ resolver: OEFFENTLICH, privatErlaubt: true, fetchFn: async () => ({ status: 200 }), jetzt: T0 });
    expect(zustellungen(hook.id)[0].status).toBe('ok');
  });

  it('Test senden und erneut senden legen neue Zustellungen an; Test geht nur an diesen Webhook', async () => {
    const a = m.wh.legeWebhookAn('https://a.example.com/', ['antwort']);
    const b = m.wh.legeWebhookAn('https://b.example.com/', ['antwort']);
    expect(m.wh.sendeTest(a.id, T0)).toBe(true);
    expect(m.wh.sendeTest(99999)).toBe(false);
    expect(zustellungen(a.id)).toHaveLength(1);
    expect(zustellungen(b.id)).toHaveLength(0);
    expect(zustellungen(a.id)[0].ereignis).toBe('test');
    await m.zu.stelleFaelligeZu({ resolver: OEFFENTLICH, fetchFn: async () => ({ status: 500 }), jetzt: T0 });
    const ersteId = zustellungen(a.id)[0].id;
    expect(m.wh.sendeErneut(ersteId, T0)).toBe(true);
    const alle = zustellungen(a.id);
    expect(alle).toHaveLength(2);
    expect(alle[1]).toMatchObject({ ereignis: 'test', status: 'offen', versuche: 0 });
    expect(alle[1].payload).toEqual(alle[0].payload);
    expect(m.wh.sendeErneut(99999)).toBe(false);
  });

  it('Protokoll: höchstens 100 je Webhook, alte (> 30 Tage) werden aufgeräumt, Löschen entfernt die Zustellungen', () => {
    const { getDb, schema } = m.db;
    const a = m.wh.legeWebhookAn('https://a.example.com/', ['antwort']);
    for (let i = 0; i < 105; i++) m.wh.sendeTest(a.id, T0);
    expect(m.wh.ladeProtokoll([a.id]).get(a.id)).toHaveLength(100);
    const jetzt = new Date(T0.getTime() + 31 * 24 * 3600_000);
    expect(m.wh.raeumeZustellungenAuf(jetzt)).toBe(105);
    m.wh.sendeTest(a.id, jetzt);
    expect(m.wh.raeumeZustellungenAuf(jetzt)).toBe(0);
    getDb().delete(schema.webhooks).where(eq(schema.webhooks.id, a.id)).run();
    expect(zustellungen()).toHaveLength(0);
  });
});

describe('Auslösen an den Quellen', () => {
  it('nur aktive Webhooks mit abonniertem Ereignis bekommen eine Zustellung', () => {
    const { getDb, schema } = m.db;
    const a = m.wh.legeWebhookAn('https://a.example.com/', ['antwort']);
    const b = m.wh.legeWebhookAn('https://b.example.com/', ['bounce']);
    const c = m.wh.legeWebhookAn('https://c.example.com/', ['antwort']);
    getDb().update(schema.webhooks).set({ aktiv: false }).where(eq(schema.webhooks.id, c.id)).run();
    const l = lead(kampagne().id);
    expect(m.wh.webhookAusloesen('antwort', { leadId: l.id })).toBe(1);
    expect(zustellungen(a.id)).toHaveLength(1);
    expect(zustellungen(b.id)).toHaveLength(0);
    expect(zustellungen(c.id)).toHaveLength(0);
    // unbekannter Lead: nichts, kein Fehler
    expect(m.wh.webhookAusloesen('antwort', { leadId: 987654 })).toBe(0);
  });

  it('antwort und bounce aus pruefeAntwort', async () => {
    const hook = m.wh.legeWebhookAn('https://a.example.com/', ['antwort', 'bounce', 'abwesenheit']);
    const k = kampagne();
    const holen = (id: number) => m.db.getDb().select().from(m.db.schema.leads).where(eq(m.db.schema.leads.id, id)).get()!;
    const mk = () => lead(k.id, { sendStatus: 'gesendet', sentAt: T0, gmailThreadId: `t${++nr}`, absenderId: postfachId });
    const l1 = mk();
    await m.send.pruefeAntwort(holen(l1.id), async () => 'antwort', T0);
    const l2 = mk();
    await m.send.pruefeAntwort(holen(l2.id), async () => 'bounce', T0);
    const l3 = mk();
    await m.send.pruefeAntwort(holen(l3.id), async () => 'abwesenheit', T0);
    // zweite Abwesenheitserkennung löst nichts mehr aus
    await m.send.pruefeAntwort(holen(l3.id), async () => 'abwesenheit', T0);
    const z = zustellungen(hook.id);
    expect(z.map((x) => x.ereignis)).toEqual(['antwort', 'bounce', 'abwesenheit']);
    expect((z[0].payload as { daten: { lead: { id: number } } }).daten.lead.id).toBe(l1.id);
    expect((z[2].payload as { daten: { bis: string | null } }).daten.bis).not.toBeNull();
  });

  it('lead_status nur bei echter Änderung, mit alt/neu', () => {
    const hook = m.wh.legeWebhookAn('https://a.example.com/', ['lead_status']);
    const l = lead(kampagne().id);
    m.status.setzeLeadStatus(l.id, 'interessiert', T0);
    m.status.setzeLeadStatus(l.id, 'interessiert', T0);
    const z = zustellungen(hook.id);
    expect(z).toHaveLength(1);
    const d = (z[0].payload as { daten: { alt: string; neu: string; lead: { leadStatus: string } } }).daten;
    expect(d).toMatchObject({ alt: 'offen', neu: 'interessiert' });
    expect(d.lead.leadStatus).toBe('interessiert');
  });

  it('video_angesehen nur beim ersten Nicht-Bot-page_view; Bot-Events lösen nichts aus', () => {
    const hook = m.wh.legeWebhookAn('https://a.example.com/', ['video_angesehen', 'video_gestartet', 'termin_klick', 'link_klick']);
    const l = lead(kampagne().id);
    const ev = (type: Parameters<typeof m.tracking.recordEvent>[0]['type'], isBot: boolean, meta?: Record<string, unknown>) =>
      m.tracking.recordEvent({ leadId: l.id, type, meta, ipHash: 'h', userAgent: isBot ? 'Googlebot' : 'Mozilla', isBot });
    ev('page_view', true);
    ev('play', true);
    ev('cta_click', true);
    ev('link_click', true, { url: 'https://x.de' });
    expect(zustellungen(hook.id)).toHaveLength(0);
    ev('page_view', false);
    ev('page_view', false);
    ev('play', false);
    ev('play', false);
    ev('cta_click', false);
    ev('link_click', false, { url: 'https://ziel.de/a' });
    ev('progress_50', false);
    const z = zustellungen(hook.id);
    expect(z.map((x) => x.ereignis)).toEqual(['video_angesehen', 'video_gestartet', 'termin_klick', 'link_klick']);
    expect((z[3].payload as { daten: { url: string } }).daten.url).toBe('https://ziel.de/a');
    expect((z[0].payload as { daten: { lead: { score: number } } }).daten.lead.score).toBeGreaterThanOrEqual(0);
  });

  it('abmeldung nur beim ersten Mal', () => {
    const hook = m.wh.legeWebhookAn('https://a.example.com/', ['abmeldung']);
    const l = lead(kampagne().id);
    m.suppression.unsubscribeBySlug(l.slug);
    m.suppression.unsubscribeBySlug(l.slug);
    expect(zustellungen(hook.id)).toHaveLength(1);
    expect(zustellungen(hook.id)[0].ereignis).toBe('abmeldung');
  });

  it('mail_gesendet bei Erstmail', async () => {
    const hook = m.wh.legeWebhookAn('https://a.example.com/', ['mail_gesendet']);
    const l = lead(kampagne().id, { sendStatus: 'geplant', renderStatus: 'fertig' });
    const sender = async () => ({ id: 'm1', threadId: 't1' });
    const res = await m.send.sendLead(l.id, { sender, absenderId: postfachId, now: T0, force: true });
    expect(res.ok).toBe(true);
    const z = zustellungen(hook.id);
    expect(z).toHaveLength(1);
    expect((z[0].payload as { daten: { schritt: number } }).daten.schritt).toBe(0);
  });

  it('ein defekter Webhook-Zustand stört die Quelle nicht (Auslösen wirft nie)', () => {
    const { getSqlite } = m.db;
    const l = lead(kampagne().id);
    m.wh.legeWebhookAn('https://a.example.com/', ['antwort']);
    getSqlite().exec('ALTER TABLE webhook_zustellungen RENAME TO webhook_zustellungen_x');
    try {
      expect(m.wh.webhookAusloesen('antwort', { leadId: l.id })).toBe(0);
    } finally {
      getSqlite().exec('ALTER TABLE webhook_zustellungen_x RENAME TO webhook_zustellungen');
    }
  });
});
