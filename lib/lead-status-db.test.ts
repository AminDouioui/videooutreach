import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { legePostfachAn, setzePostfaecherZurueck } from './test-postfach';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-status-'));
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
  status: typeof import('./lead-status-db');
  settings: typeof import('./settings');
  campaigns: typeof import('./campaigns');
  listen: typeof import('./lead-listen');
};
let m: Mods;
let nr = 0;

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
  const [k] = getDb()
    .insert(schema.campaigns)
    .values({ name: 'Status', ctaUrl: 'https://x.de', emailSubjectTemplate: 'Hallo {{firma}}', emailBodyTemplate: '{{begruessung}}', status: 'versendet_laufend', dailySendLimit: 50, ...extra })
    .returning()
    .all();
  return k;
}
function neuerLead(campaignId: number, extra: Partial<typeof import('@/db/schema').leads.$inferInsert> = {}) {
  const { getDb, schema } = m.db;
  nr++;
  const [l] = getDb()
    .insert(schema.leads)
    .values({ campaignId, firma: `Firma ${nr}`, email: `f${nr}@kunde.de`, slug: `st-${nr}`, renderStatus: 'fertig', sendStatus: 'geplant', ...extra })
    .returning()
    .all();
  return l;
}
const lead = (id: number) => m.db.getDb().select().from(m.db.schema.leads).where(eq(m.db.schema.leads.id, id)).get()!;

beforeAll(async () => {
  m = {
    db: await import('./db'),
    loop: await import('./send-loop'),
    send: await import('./send'),
    status: await import('./lead-status-db'),
    settings: await import('./settings'),
    campaigns: await import('./campaigns'),
    listen: await import('./lead-listen'),
  };
  m.db.getDb();
  await legePostfachAn();
});

beforeEach(async () => {
  m.db.getDb().update(m.db.schema.campaigns).set({ status: 'pausiert' }).run();
  await setzePostfaecherZurueck();
});

describe('Lead-Status in der Versandschleife', () => {
  it('sendet nach einem Flow-beendenden Status kein Follow-up mehr', async () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'Nachfassen' }]);
    const l = neuerLead(k.id);
    const { gesendet, sender } = fakeSender();
    const pruefer = async () => null;

    expect((await m.loop.runSendTick({ sender, pruefer, now: T0, zufall })).sent).toBe(1);
    expect(m.status.setzeLeadStatus(l.id, 'nicht_interessiert', tag(0.5))).toBe(true);
    expect(lead(l.id)).toMatchObject({ leadStatus: 'nicht_interessiert', flowStopp: 'status' });

    const r = await m.loop.runSendTick({ sender, pruefer, now: tag(2), zufall });
    expect(r.sent).toBe(0);
    expect(gesendet).toHaveLength(1);
    expect(r.completed).toContain(k.id);
  });

  it('überspringt die Erstmail eines Leads mit beendendem Status', async () => {
    const k = neueKampagne();
    const l = neuerLead(k.id, { sendStatus: 'nicht_gesendet' });
    const andere = neuerLead(k.id);
    m.status.setzeLeadStatus(l.id, 'falscher_ansprechpartner');
    expect(lead(l.id)).toMatchObject({ sendStatus: 'uebersprungen', sendError: 'Lead-Status: Falscher Ansprechpartner' });

    const { gesendet, sender } = fakeSender();
    await m.loop.runSendTick({ sender, pruefer: async () => null, now: T0, zufall });
    expect(gesendet).toHaveLength(1);
    expect(lead(andere.id).sendStatus).toBe('gesendet');
    expect(lead(l.id).sendStatus).toBe('uebersprungen');
  });

  it('sendet auch dann nicht, wenn nur der Status gesetzt ist (z. B. direkter DB-Eingriff)', async () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 1, body: 'Nachfassen' }]);
    const l = neuerLead(k.id);
    const { gesendet, sender } = fakeSender();
    m.db.getDb().update(m.db.schema.leads).set({ leadStatus: 'verloren' }).where(eq(m.db.schema.leads.id, l.id)).run();
    expect((await m.send.sendLead(l.id, { sender, now: T0 })).ok).toBe(false);
    expect(gesendet).toHaveLength(0);

    const l2 = neuerLead(k.id);
    await m.loop.runSendTick({ sender, pruefer: async () => null, now: T0, zufall });
    expect(lead(l2.id).sendStatus).toBe('gesendet');
    m.db.getDb().update(m.db.schema.leads).set({ leadStatus: 'gewonnen' }).where(eq(m.db.schema.leads.id, l2.id)).run();
    const res = await m.send.sendFollowup(l2.id, { sender, pruefer: async () => null, now: tag(2) });
    expect(res).toMatchObject({ ok: false, kind: 'flow_beendet' });
    expect(gesendet).toHaveLength(1);
  });

  it('Status zurück auf offen reaktiviert nur einen per Status gestoppten Flow', async () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'Nachfassen' }]);
    const status = neuerLead(k.id, { sendStatus: 'gesendet', gmailThreadId: 't1', rfcMessageId: '<a@b>', sentAt: T0 });
    const antwort = neuerLead(k.id, { sendStatus: 'gesendet', gmailThreadId: 't2', rfcMessageId: '<c@d>', sentAt: T0, flowStopp: 'beantwortet', flowStoppAt: T0 });
    m.status.setzeLeadStatus(status.id, 'verloren');
    m.status.setzeLeadStatus(antwort.id, 'verloren');
    m.status.setzeLeadStatus(status.id, 'offen');
    m.status.setzeLeadStatus(antwort.id, 'offen');
    expect(lead(status.id)).toMatchObject({ flowStopp: null, leadStatus: 'offen', leadStatusAt: null });
    expect(lead(antwort.id).flowStopp).toBe('beantwortet');
  });
});

describe('Antwort erkennen und Firmen-Stopp', () => {
  async function antworteAuf(id: number, jetzt = tag(1)) {
    await m.send.pruefeAntwort(lead(id), async () => 'antwort', jetzt);
  }

  it('setzt antwortAt, ungelesen und zählt ungelesene Antworten', async () => {
    const k = neueKampagne({ stoppBeiFirmenAntwort: false });
    const l = neuerLead(k.id, { sendStatus: 'gesendet', gmailThreadId: 't1' });
    const vorher = m.status.zaehleUngeleseneAntworten();
    await antworteAuf(l.id);
    expect(lead(l.id)).toMatchObject({ flowStopp: 'beantwortet', antwortGelesen: false });
    expect(lead(l.id).antwortAt?.getTime()).toBe(tag(1).getTime());
    expect(m.status.zaehleUngeleseneAntworten()).toBe(vorher + 1);
    m.status.setzeAntwortGelesen(l.id, true);
    expect(m.status.zaehleUngeleseneAntworten()).toBe(vorher);
  });

  it('stoppt Kollegen derselben Domain: gesendete Flows und offene Erstmails', async () => {
    const k = neueKampagne();
    const antwortet = neuerLead(k.id, { email: 'a@mueller-bau.de', sendStatus: 'gesendet', gmailThreadId: 'ta' });
    const gesendet = neuerLead(k.id, { email: 'B@Mueller-Bau.de', sendStatus: 'gesendet', gmailThreadId: 'tb' });
    const offen = neuerLead(k.id, { email: 'c@mueller-bau.de', sendStatus: 'geplant' });
    const andere = neuerLead(k.id, { email: 'd@anders.de', sendStatus: 'gesendet', gmailThreadId: 'td' });
    const ähnlich = neuerLead(k.id, { email: 'e@xmueller-bau.de', sendStatus: 'geplant' });
    const andereKampagne = neuerLead(neueKampagne().id, { email: 'f@mueller-bau.de', sendStatus: 'gesendet', gmailThreadId: 'tf' });

    await antworteAuf(antwortet.id);
    expect(lead(antwortet.id).flowStopp).toBe('beantwortet');
    expect(lead(gesendet.id).flowStopp).toBe('firma_beantwortet');
    expect(lead(offen.id)).toMatchObject({ sendStatus: 'uebersprungen', sendError: 'Firma hat geantwortet' });
    expect(lead(andere.id).flowStopp).toBeNull();
    expect(lead(ähnlich.id).sendStatus).toBe('geplant');
    expect(lead(andereKampagne.id).flowStopp).toBeNull();
    // Kollegen erscheinen nicht als „beantwortet“ im Postfach
    expect(m.listen.ladeAntworten({ gelesen: 'alle', leadStatus: '' }).map((x) => x.lead.id)).not.toContain(gesendet.id);
  });

  it('beachtet die Kampagnen-Option', async () => {
    const k = neueKampagne({ stoppBeiFirmenAntwort: false });
    const a = neuerLead(k.id, { email: 'a@firma-x.de', sendStatus: 'gesendet', gmailThreadId: 'ta' });
    const b = neuerLead(k.id, { email: 'b@firma-x.de', sendStatus: 'gesendet', gmailThreadId: 'tb' });
    await antworteAuf(a.id);
    expect(lead(b.id).flowStopp).toBeNull();
  });

  it('nimmt Freemail-Domains aus', async () => {
    const k = neueKampagne();
    const a = neuerLead(k.id, { email: 'a@gmail.com', sendStatus: 'gesendet', gmailThreadId: 'ta' });
    const b = neuerLead(k.id, { email: 'b@gmail.com', sendStatus: 'gesendet', gmailThreadId: 'tb' });
    const c = neuerLead(k.id, { email: 'c@gmx.de', sendStatus: 'geplant' });
    const d = neuerLead(k.id, { email: 'd@gmx.de', sendStatus: 'geplant' });
    await antworteAuf(a.id);
    await antworteAuf(c.id);
    expect(lead(b.id).flowStopp).toBeNull();
    expect(lead(d.id).sendStatus).toBe('geplant');
  });

  it('die Versandschleife sendet an gestoppte Firmenkollegen nichts mehr', async () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'Nachfassen' }]);
    const a = neuerLead(k.id, { email: 'a@firma-y.de' });
    const b = neuerLead(k.id, { email: 'b@firma-y.de', sendStatus: 'gesendet', gmailThreadId: 'tb', rfcMessageId: '<x@y>', sentAt: T0 });
    m.db.getDb().insert(m.db.schema.sentMessages).values({ leadId: b.id, campaignId: k.id, step: 0, sentAt: T0 }).run();
    const { gesendet, sender } = fakeSender();
    await setzePostfaecherZurueck();
    await m.send.pruefeAntwort({ ...lead(b.id), gmailThreadId: 'tb' }, async () => 'antwort', T0);
    expect(lead(a.id).sendStatus).toBe('uebersprungen');
    const r = await m.loop.runSendTick({ sender, pruefer: async () => null, now: tag(3), zufall });
    expect(r.sent).toBe(0);
    expect(gesendet).toHaveLength(0);
  });
});

describe('Listen', () => {
  it('Postfach: neueste Antwort zuerst, Filter ungelesen und Lead-Status', async () => {
    const k = neueKampagne({ stoppBeiFirmenAntwort: false });
    const alt = neuerLead(k.id, { sendStatus: 'gesendet', flowStopp: 'beantwortet', flowStoppAt: tag(1), antwortAt: tag(1), antwortGelesen: true });
    const neu = neuerLead(k.id, { sendStatus: 'gesendet', flowStopp: 'beantwortet', flowStoppAt: tag(5), antwortAt: tag(5), leadStatus: 'interessiert' });
    const ids = (f: Parameters<typeof m.listen.ladeAntworten>[0]) => m.listen.ladeAntworten(f).map((x) => x.lead.id).filter((id) => id === alt.id || id === neu.id);
    expect(ids({ gelesen: 'alle', leadStatus: '' })).toEqual([neu.id, alt.id]);
    expect(ids({ gelesen: 'ungelesen', leadStatus: '' })).toEqual([neu.id]);
    expect(ids({ gelesen: 'alle', leadStatus: 'interessiert' })).toEqual([neu.id]);
  });

  it('Leads-Seite: Suche, Filter und Paginierung', () => {
    const k = neueKampagne();
    const gesucht = neuerLead(k.id, { firma: 'Zebra Lacke GmbH', email: 'info@zebra-lacke.de', score: 99 });
    neuerLead(k.id, { firma: 'Prozent 100% Markt', email: 'x@prozent.de' });
    const f = m.listen.parseLeadsFilter({ q: 'zebra' });
    expect(m.listen.ladeLeadsSeite(f).zeilen.map((z) => z.lead.id)).toEqual([gesucht.id]);
    expect(m.listen.ladeLeadsSeite(m.listen.parseLeadsFilter({ q: '100%' })).total).toBe(1);
    expect(m.listen.ladeLeadsSeite(m.listen.parseLeadsFilter({ q: '%' })).total).toBe(1);
    const nachScore = m.listen.ladeLeadsSeite(m.listen.parseLeadsFilter({ kampagne: String(k.id) }));
    expect(nachScore.zeilen[0].lead.id).toBe(gesucht.id);
    const seite = m.listen.ladeLeadsSeite(m.listen.parseLeadsFilter({ kampagne: String(k.id) }), 1);
    expect(seite.zeilen).toHaveLength(1);
    expect(seite.seiten).toBe(2);
    expect(m.listen.parseLeadsFilter({ status: 'quatsch', seite: '-3', sort: 'x' })).toMatchObject({ leadStatus: '', seite: 1, sort: 'score' });
  });
});
