import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

// Eigene Test-DB, bevor lib/db das erste Mal geöffnet wird
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-send-'));
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

type Mods = { db: typeof import('./db'); loop: typeof import('./send-loop'); send: typeof import('./send'); sup: typeof import('./suppression'); settings: typeof import('./settings') };
let m: Mods;

// Mittwoch 11:00 Berlin
const T0 = new Date('2026-07-15T09:00:00Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

function neueKampagne(limit = 10) {
  const { getDb, schema } = m.db;
  const [k] = getDb()
    .insert(schema.campaigns)
    .values({ name: 'T', ctaUrl: 'https://x.de', emailSubjectTemplate: 'Hallo {{firma}}', emailBodyTemplate: '{{begruessung}}\n\n{{vorschaubild}}', status: 'versendet_laufend', dailySendLimit: limit })
    .returning()
    .all();
  return k;
}
function neuerLead(campaignId: number, nr: number, extra: Partial<typeof import('@/db/schema').leads.$inferInsert> = {}) {
  const { getDb, schema } = m.db;
  const [l] = getDb()
    .insert(schema.leads)
    .values({ campaignId, firma: `Firma ${nr}`, email: `l${campaignId}-${nr}@x.de`, slug: `f${campaignId}-${nr}`, renderStatus: 'fertig', sendStatus: 'geplant', ...extra })
    .returning()
    .all();
  return l;
}

beforeAll(async () => {
  m = { db: await import('./db'), loop: await import('./send-loop'), send: await import('./send'), sup: await import('./suppression'), settings: await import('./settings') };
  m.db.getDb();
});

describe('Versandschleife mit Fake-Sender', () => {
  it('sendet mit Abstand, respektiert Kampagnenlimit und schließt ab', async () => {
    const k = neueKampagne(2);
    const ls = [1, 2, 3].map((n) => neuerLead(k.id, n));
    const gesendet: string[] = [];
    const sender = async (raw: string) => {
      gesendet.push(Buffer.from(raw, 'base64url').toString('utf8'));
      return { id: `m${gesendet.length}`, threadId: `t${gesendet.length}` };
    };
    const zufall = () => 0; // Abstand = 3 min

    expect((await m.loop.runSendTick({ sender, now: T0, zufall })).sent).toBe(1);
    // Abstand noch nicht verstrichen
    const r2 = await m.loop.runSendTick({ sender, now: min(2), zufall });
    expect(r2.sent).toBe(0);
    expect(r2.waiting).toContain(`${k.id}:abstand`);
    // nach 3 min: zweite Mail
    expect((await m.loop.runSendTick({ sender, now: min(3), zufall })).sent).toBe(1);
    // Kampagnenlimit 2 erreicht
    const r4 = await m.loop.runSendTick({ sender, now: min(10), zufall });
    expect(r4.sent).toBe(0);
    expect(r4.waiting).toContain(`${k.id}:limit_kampagne`);
    expect(gesendet).toHaveLength(2);

    const { getDb, schema } = m.db;
    const rows = getDb().select().from(schema.leads).where(eq(schema.leads.campaignId, k.id)).all();
    expect(rows.filter((r) => r.sendStatus === 'gesendet')).toHaveLength(2);
    expect(rows.find((r) => r.id === ls[0].id)?.gmailMessageId).toBe('m1');
    expect(gesendet[0]).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    expect(gesendet[0]).toContain('To: l' + k.id + '-1@x.de');
    expect(getDb().select().from(schema.campaigns).where(eq(schema.campaigns.id, k.id)).get()?.status).toBe('versendet_laufend');
  });

  it('außerhalb des Fensters wird nichts gesendet', async () => {
    const k = neueKampagne();
    neuerLead(k.id, 1);
    let n = 0;
    const sender = async () => ({ id: `x${++n}`, threadId: 't' });
    const r = await m.loop.runSendTick({ sender, now: new Date('2026-07-15T20:00:00Z') });
    expect(r.sent).toBe(0);
    expect(r.waiting).toContain(`${k.id}:fenster_zu`);
    expect(n).toBe(0);
  });

  it('Sperrliste/Abmeldung werden übersprungen, Kampagne danach abgeschlossen', async () => {
    const { getDb, schema } = m.db;
    for (const k0 of getDb().select().from(schema.campaigns).all()) getDb().update(schema.campaigns).set({ status: 'pausiert' }).where(eq(schema.campaigns.id, k0.id)).run();
    const k = neueKampagne();
    const a = neuerLead(k.id, 1);
    const b = neuerLead(k.id, 2, { unsubscribed: true });
    m.sup.addSuppression(a.email, 'manuell');
    const sender = async () => {
      throw new Error('darf nicht senden');
    };
    const r = await m.loop.runSendTick({ sender, now: T0 });
    expect(r.completed).toContain(k.id);
    const rows = getDb().select().from(schema.leads).where(eq(schema.leads.campaignId, k.id)).all();
    expect(rows.map((x) => x.sendStatus)).toEqual(['uebersprungen', 'uebersprungen']);
    expect(rows.find((x) => x.id === b.id)?.sendError).toBe('Abgemeldet');
  });

  it('Quota-Fehler stoppt den Versand für heute, Lead bleibt geplant', async () => {
    const { getDb, schema } = m.db;
    for (const k0 of getDb().select().from(schema.campaigns).all()) getDb().update(schema.campaigns).set({ status: 'pausiert' }).where(eq(schema.campaigns.id, k0.id)).run();
    m.settings.setSetting('send_state', '{}');
    const k = neueKampagne();
    const l = neuerLead(k.id, 1);
    const { GmailSendError } = await import('./gmail');
    const sender = async () => {
      throw new GmailSendError({ art: 'quota', meldung: 'rateLimitExceeded' });
    };
    const now = new Date('2026-07-16T09:00:00Z');
    const r1 = await m.loop.runSendTick({ sender, now });
    expect(r1.sent).toBe(0);
    expect(getDb().select().from(schema.leads).where(eq(schema.leads.id, l.id)).get()?.sendStatus).toBe('geplant');
    // gleicher Tag: kein weiterer Versuch
    let versuche = 0;
    const r2 = await m.loop.runSendTick({ sender: async () => (versuche++, { id: 'a', threadId: 'b' }), now: new Date(now.getTime() + 3600_000) });
    expect(versuche).toBe(0);
    expect(r2.waiting).toContain(`${k.id}:quota_gestoppt`);
    // nächster Tag: wieder frei
    const r3 = await m.loop.runSendTick({ sender: async () => ({ id: 'a', threadId: 'b' }), now: new Date('2026-07-17T09:00:00Z') });
    expect(r3.sent).toBe(1);
  });

  it('globales Tageslimit gilt über Kampagnen', async () => {
    const { getDb, schema } = m.db;
    for (const k0 of getDb().select().from(schema.campaigns).all()) getDb().update(schema.campaigns).set({ status: 'pausiert' }).where(eq(schema.campaigns.id, k0.id)).run();
    m.settings.setSetting('send_state', '{}');
    m.settings.setSetting('global_daily_limit', '1');
    const k1 = neueKampagne();
    const k2 = neueKampagne();
    neuerLead(k1.id, 1);
    neuerLead(k2.id, 1);
    const sender = async () => ({ id: 'a', threadId: 'b' });
    const now = new Date('2026-07-20T09:00:00Z'); // Montag
    const r0 = await m.loop.runSendTick({ sender, now, zufall: () => 0 });
    expect(r0.waiting).toEqual([]);
    expect(r0.sent).toBe(1);
    const r = await m.loop.runSendTick({ sender, now: new Date(now.getTime() + 600_000), zufall: () => 0 });
    expect(r.sent).toBe(0);
    expect(r.waiting.some((w) => w.endsWith('limit_global'))).toBe(true);
  });

  it('sendLead ohne Gmail-Verbindung liefert saubere Meldung', async () => {
    const k = neueKampagne();
    const l = neuerLead(k.id, 9);
    const r = await m.send.sendLead(l.id);
    expect(r).toMatchObject({ ok: false, error: 'Gmail nicht verbunden' });
  });
});
