import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { legePostfachAn, setzePostfaecherZurueck } from './test-postfach';

// Eigene Test-DB, bevor lib/db das erste Mal geöffnet wird
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-abw-'));
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
  loop: typeof import('./send-loop');
  send: typeof import('./send');
  campaigns: typeof import('./campaigns');
  absender: typeof import('./absender');
  settings: typeof import('./settings');
};
let m: Mods;
let nr = 0;
let postfachId = 0;

// Mittwoch 11:00 Berlin
const T0 = new Date('2026-07-15T09:00:00Z');
const tag = (n: number) => new Date(T0.getTime() + n * 24 * 3600_000);
const zufall = () => 0;

function fakeSender() {
  const gesendet: { raw: string; threadId?: string }[] = [];
  const sender = async (raw: string, threadId?: string) => {
    gesendet.push({ raw: Buffer.from(raw, 'base64url').toString('utf8'), threadId });
    return { id: `m${gesendet.length}`, threadId: threadId ?? `t${gesendet.length}` };
  };
  return { gesendet, sender };
}

function neueKampagne(extra: Partial<typeof import('@/db/schema').campaigns.$inferInsert> = {}) {
  const { getDb, schema } = m.db;
  return getDb()
    .insert(schema.campaigns)
    .values({ name: 'Abw', ctaUrl: 'https://x.de', emailSubjectTemplate: 'Hallo {{firma}}', emailBodyTemplate: '{{begruessung}}\n\n{{vorschaubild}}', status: 'versendet_laufend', dailySendLimit: 50, ...extra })
    .returning()
    .get();
}
function neuerLead(campaignId: number, extra: Partial<typeof import('@/db/schema').leads.$inferInsert> = {}) {
  const { getDb, schema } = m.db;
  nr++;
  return getDb()
    .insert(schema.leads)
    .values({ campaignId, firma: `Firma ${nr}`, email: `f${nr}@kunde.de`, slug: `abw-${nr}`, renderStatus: 'fertig', sendStatus: 'geplant', ...extra })
    .returning()
    .get();
}
const lead = (id: number) => m.db.getDb().select().from(m.db.schema.leads).where(eq(m.db.schema.leads.id, id)).get()!;
const kampagne = (id: number) => m.db.getDb().select().from(m.db.schema.campaigns).where(eq(m.db.schema.campaigns.id, id)).get()!;
const events = (leadId: number) => m.db.getDb().select().from(m.db.schema.events).where(eq(m.db.schema.events.leadId, leadId)).all();
const tage = (a: Date, b: Date) => Math.round(((b.getTime() - a.getTime()) / (24 * 3600_000)) * 100) / 100;

beforeAll(async () => {
  m = {
    db: await import('./db'),
    loop: await import('./send-loop'),
    send: await import('./send'),
    campaigns: await import('./campaigns'),
    absender: await import('./absender'),
    settings: await import('./settings'),
  };
  m.db.getDb();
  postfachId = (await legePostfachAn()).id;
});

beforeEach(async () => {
  m.db.getDb().update(m.db.schema.campaigns).set({ status: 'pausiert' }).run();
  await setzePostfaecherZurueck();
});

describe('Abwesenheitsnotiz im Flow', () => {
  it('verschiebt das Follow-up, stoppt den Flow nicht und zählt nicht als Antwort', async () => {
    const k = neueKampagne({ abwesenheitVerschiebenTage: 7 });
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'Nachfassen' }]);
    const l = neuerLead(k.id);
    const { gesendet, sender } = fakeSender();

    await m.loop.runSendTick({ sender, pruefer: async () => null, now: T0, zufall });
    expect(gesendet).toHaveLength(1);

    // Follow-up fällig, aber die Prüfung findet eine Abwesenheitsnotiz: nichts wird gesendet
    const r = await m.loop.runSendTick({ sender, pruefer: async () => 'abwesenheit', now: tag(2), zufall });
    expect(r.sent).toBe(0);
    expect(gesendet).toHaveLength(1);
    const nachAbw = lead(l.id);
    expect(nachAbw.flowStopp).toBeNull();
    expect(nachAbw.antwortAt).toBeNull();
    expect(nachAbw.abwesendAt).not.toBeNull();
    expect(tage(tag(2), nachAbw.abwesendBis!)).toBe(7);
    expect(events(l.id).filter((e) => e.type === 'abwesenheit')).toHaveLength(1);

    // Während der Abwesenheit wird nichts gesendet (Prüfung wird gar nicht mehr nötig)
    expect((await m.loop.runSendTick({ sender, pruefer: async () => 'abwesenheit', now: tag(8), zufall })).sent).toBe(0);
    expect(gesendet).toHaveLength(1);

    // Danach geht das Follow-up raus; die Notiz wird nicht doppelt erfasst
    expect((await m.loop.runSendTick({ sender, pruefer: async () => 'abwesenheit', now: tag(9.1), zufall })).sent).toBe(1);
    expect(gesendet).toHaveLength(2);
    expect(lead(l.id).followupsSent).toBe(1);
    expect(events(l.id).filter((e) => e.type === 'abwesenheit')).toHaveLength(1);
  });

  it('verschiebt nichts bei 0 Tagen, merkt sich die Notiz aber', async () => {
    const k = neueKampagne({ abwesenheitVerschiebenTage: 0 });
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'Nachfassen' }]);
    const l = neuerLead(k.id);
    const { gesendet, sender } = fakeSender();
    await m.loop.runSendTick({ sender, pruefer: async () => null, now: T0, zufall });

    expect((await m.loop.runSendTick({ sender, pruefer: async () => 'abwesenheit', now: tag(2), zufall })).sent).toBe(1);
    expect(gesendet).toHaveLength(2);
    const x = lead(l.id);
    expect(x.abwesendAt).not.toBeNull();
    expect(x.abwesendBis).toBeNull();
  });

  it('erkennt eine spätere echte Antwort im selben Thread und stoppt dann den Flow', async () => {
    // Die Hintergrund-Prüfung nimmt immer den am längsten ungeprüften Thread: Leads früherer Tests ausblenden
    m.db.getDb().delete(m.db.schema.leads).run();
    const k = neueKampagne({ abwesenheitVerschiebenTage: 7 });
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'Nachfassen' }]);
    const l = neuerLead(k.id);
    const { gesendet, sender } = fakeSender();
    await m.loop.runSendTick({ sender, pruefer: async () => null, now: T0, zufall });
    await m.loop.runSendTick({ sender, pruefer: async () => 'abwesenheit', now: tag(2), zufall });
    expect(lead(l.id).flowStopp).toBeNull();

    // Hintergrund-Prüfung (stündlich) findet jetzt eine echte Antwort neben der Abwesenheitsnotiz
    const r = await m.loop.runSendTick({ sender, pruefer: async () => 'antwort', now: tag(3), zufall });
    expect(r.sent).toBe(0);
    const x = lead(l.id);
    expect(x.flowStopp).toBe('beantwortet');
    expect(x.antwortAt).not.toBeNull();
    expect(gesendet).toHaveLength(1);
  });

  it('pruefeAntwort: Abwesenheit meldet "Flow läuft weiter" (false)', async () => {
    const k = neueKampagne();
    const l = neuerLead(k.id, { sendStatus: 'gesendet', sentAt: T0, gmailThreadId: 'tx', absenderId: postfachId });
    expect(await m.send.pruefeAntwort(lead(l.id), async () => 'abwesenheit', T0)).toBe(false);
    expect(lead(l.id).abwesendAt).not.toBeNull();
    expect(lead(l.id).flowStopp).toBeNull();
  });
});

describe('Bounce-Schutz', () => {
  // Quote des Postfachs zählt alle seine Erstmails: jeder Test startet ohne Leads aus früheren Tests
  beforeEach(() => {
    m.db.getDb().delete(m.db.schema.leads).run();
  });

  /** Legt n gesendete Erstmails an; die ersten `gebounct` sind bereits als Bounce erkannt. */
  function gesendeteLeads(campaignId: number, n: number, gebounct: number) {
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      const l = neuerLead(campaignId, {
        sendStatus: 'gesendet',
        sentAt: new Date(T0.getTime() + i * 60_000),
        gmailThreadId: `th-${campaignId}-${i}`,
        absenderId: postfachId,
        flowStopp: i < gebounct ? 'bounce' : null,
      });
      ids.push(l.id);
    }
    return ids;
  }

  it('pausiert Kampagne und Postfach über der Schwelle (ab 20 gesendeten Erstmails)', async () => {
    const k = neueKampagne({ bounceSchwelleProzent: 5, bounceFenster: 50 });
    const ids = gesendeteLeads(k.id, 30, 1); // 1 von 30 = 3,3 % -> ok
    expect(await m.send.pruefeAntwort(lead(ids[1]), async () => 'bounce', tag(1))).toBe(true); // 2 von 30 = 6,7 %
    const kk = kampagne(k.id);
    expect(kk.status).toBe('pausiert');
    expect(kk.pausiertGrund).toContain('Bounce-Schutz');
    expect(kk.pausiertGrund).toContain('6,7 %');
    const a = m.absender.ladeAbsenderMitId(postfachId)!;
    expect(a.aktiv).toBe(false);
    expect(a.fehler).toBe('Bounce-Quote zu hoch (6,7 %)');
  });

  it('pausiert nicht unter der Schwelle oder mit weniger als 20 Erstmails', async () => {
    const k1 = neueKampagne();
    const klein = gesendeteLeads(k1.id, 10, 0);
    expect(await m.send.pruefeAntwort(lead(klein[0]), async () => 'bounce', tag(1))).toBe(true); // 10 % bei 10 Mails
    expect(kampagne(k1.id).status).toBe('versendet_laufend');
    expect(m.absender.ladeAbsenderMitId(postfachId)!.aktiv).toBe(true);

    const k2 = neueKampagne();
    const gross = gesendeteLeads(k2.id, 100, 0);
    // 5 von 100 = exakt 5 % im Postfach und in der Kampagne (Fenster 50: 2 von 50 = 4 %) -> kein Alarm
    for (const id of gross.slice(0, 2)) m.db.getDb().update(m.db.schema.leads).set({ flowStopp: 'bounce' }).where(eq(m.db.schema.leads.id, id)).run();
    expect(await m.send.pruefeAntwort(lead(gross[2]), async () => 'bounce', tag(1))).toBe(true);
    // Die ersten Leads sind die ältesten – das Fenster der letzten 50 enthält nur den dritten Bounce nicht: 0 von 50
    expect(kampagne(k2.id).status).toBe('versendet_laufend');
  });

  it('respektiert "Bounce-Schutz aus"', async () => {
    const k = neueKampagne({ bounceSchutz: false });
    const ids = gesendeteLeads(k.id, 30, 5);
    await m.send.pruefeAntwort(lead(ids[10]), async () => 'bounce', tag(1));
    expect(kampagne(k.id).status).toBe('versendet_laufend');
  });

  it('Postfach wieder aktivieren löscht den Bounce-Grund, andere Fehler bleiben', async () => {
    const { getDb, schema } = m.db;
    getDb().update(schema.absender).set({ aktiv: false, fehler: 'Bounce-Quote zu hoch (7 %)' }).where(eq(schema.absender.id, postfachId)).run();
    m.absender.aktualisiereAbsender(postfachId, { aktiv: true });
    expect(m.absender.ladeAbsenderMitId(postfachId)).toMatchObject({ aktiv: true, fehler: null });
    getDb().update(schema.absender).set({ fehler: 'invalid_grant' }).where(eq(schema.absender.id, postfachId)).run();
    m.absender.aktualisiereAbsender(postfachId, { aktiv: true });
    expect(m.absender.ladeAbsenderMitId(postfachId)!.fehler).toBe('invalid_grant');
  });
});
