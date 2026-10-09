import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Eigene Test-DB, bevor lib/db das erste Mal geöffnet wird
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-flow-'));
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
  settings: typeof import('./settings');
  campaigns: typeof import('./campaigns');
  gmail: typeof import('./gmail');
  media: typeof import('./media');
};
let m: Mods;
let nr = 0;

// Mittwoch 11:00 Berlin; Follow-ups mit 2 Tagen Wartezeit fallen auf Freitag 11:00
const T0 = new Date('2026-07-15T09:00:00Z');
const tag = (n: number) => new Date(T0.getTime() + n * 24 * 3600_000);
const zufall = () => 0;

type Gesendet = { raw: string; threadId?: string };
function fakeSender() {
  const gesendet: Gesendet[] = [];
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
    .values({ name: 'Flow', ctaUrl: 'https://x.de', emailSubjectTemplate: 'Hallo {{firma}}', emailBodyTemplate: '{{begruessung}}\n\n{{vorschaubild}}', status: 'versendet_laufend', dailySendLimit: 50, ...extra })
    .returning()
    .all();
  return k;
}
function neuerLead(campaignId: number, extra: Partial<typeof import('@/db/schema').leads.$inferInsert> = {}) {
  const { getDb, schema } = m.db;
  nr++;
  const [l] = getDb()
    .insert(schema.leads)
    .values({ campaignId, firma: `Firma ${nr}`, email: `f${nr}@kunde.de`, slug: `flow-${nr}`, renderStatus: 'fertig', sendStatus: 'geplant', ...extra })
    .returning()
    .all();
  return l;
}
const lead = (id: number) => m.db.getDb().select().from(m.db.schema.leads).where(eq(m.db.schema.leads.id, id)).get()!;
const kampagne = (id: number) => m.db.getDb().select().from(m.db.schema.campaigns).where(eq(m.db.schema.campaigns.id, id)).get()!;

beforeAll(async () => {
  m = {
    db: await import('./db'),
    loop: await import('./send-loop'),
    settings: await import('./settings'),
    campaigns: await import('./campaigns'),
    gmail: await import('./gmail'),
    media: await import('./media'),
  };
  m.db.getDb();
});

beforeEach(() => {
  // Jede Prüfung für sich: andere Kampagnen anhalten, Versand-Zustand zurücksetzen
  const { getDb, schema } = m.db;
  getDb().update(schema.campaigns).set({ status: 'pausiert' }).run();
  m.settings.setSetting('send_state', '{}');
});

describe('E-Mail-Flow mit Follow-ups', () => {
  it('sendet das Follow-up nach der Wartezeit als Antwort im selben Thread', async () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: '{{begruessung}},\n\nkurz nachgehakt.' }]);
    const l = neuerLead(k.id);
    const { gesendet, sender } = fakeSender();
    const pruefer = async () => null;

    expect((await m.loop.runSendTick({ sender, pruefer, now: T0, zufall })).sent).toBe(1);
    const erst = lead(l.id);
    expect(erst.rfcMessageId).toMatch(/^<.+@prozessia\.de>$/);

    // Einen Tag später: noch nicht fällig, Kampagne läuft weiter
    const r1 = await m.loop.runSendTick({ sender, pruefer, now: tag(1), zufall });
    expect(r1.sent).toBe(0);
    expect(r1.waiting).toContain(`${k.id}:followups_spaeter`);
    expect(kampagne(k.id).status).toBe('versendet_laufend');

    // Nach 2 Tagen: Follow-up im Thread der Erstmail
    expect((await m.loop.runSendTick({ sender, pruefer, now: tag(2), zufall })).sent).toBe(1);
    expect(gesendet).toHaveLength(2);
    expect(gesendet[1].threadId).toBe(erst.gmailThreadId);
    expect(gesendet[1].raw).toContain(`In-Reply-To: ${erst.rfcMessageId}`);
    expect(gesendet[1].raw).toContain(`References: ${erst.rfcMessageId}`);
    expect(gesendet[1].raw).toContain('Subject: Re: Hallo Firma');
    expect(lead(l.id).followupsSent).toBe(1);

    // Flow durch -> Kampagne abgeschlossen
    const r3 = await m.loop.runSendTick({ sender, pruefer, now: tag(2.1), zufall });
    expect(r3.completed).toContain(k.id);
  });

  it('beendet den Flow, wenn der Lead geantwortet hat – kein Follow-up', async () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'Nachfassen' }]);
    const l = neuerLead(k.id);
    const { gesendet, sender } = fakeSender();

    await m.loop.runSendTick({ sender, pruefer: async () => null, now: T0, zufall });
    const r = await m.loop.runSendTick({ sender, pruefer: async () => 'antwort', now: tag(2), zufall });
    expect(r.sent).toBe(0);
    expect(gesendet).toHaveLength(1);
    expect(lead(l.id).flowStopp).toBe('beantwortet');
    expect((await m.loop.runSendTick({ sender, pruefer: async () => null, now: tag(2.1), zufall })).completed).toContain(k.id);
  });

  it('sendet ohne Antwort-Erkennung (alte Gmail-Verbindung) keine Follow-ups', async () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'Nachfassen' }]);
    neuerLead(k.id);
    const { gesendet, sender } = fakeSender();

    await m.loop.runSendTick({ sender, pruefer: async () => null, now: T0, zufall });
    // ohne pruefer und ohne gmail.metadata-Berechtigung
    const r = await m.loop.runSendTick({ sender, now: tag(2), zufall });
    expect(r.sent).toBe(0);
    expect(r.waiting).toContain(`${k.id}:antwort_pruefung_fehlt`);
    expect(gesendet).toHaveLength(1);
  });

  it('zählt Follow-ups im Tageslimit der Kampagne mit', async () => {
    const k = neueKampagne({ dailySendLimit: 2 });
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 1, body: 'Nachfassen' }]);
    neuerLead(k.id);
    neuerLead(k.id);
    neuerLead(k.id);
    const { sender } = fakeSender();
    const pruefer = async () => null;

    // Tag 0: zwei Erstmails (Limit 2)
    await m.loop.runSendTick({ sender, pruefer, now: T0, zufall });
    await m.loop.runSendTick({ sender, pruefer, now: new Date(T0.getTime() + 3 * 60_000), zufall });
    // Tag 1: zwei Follow-ups fällig + eine Erstmail offen -> nur 2 Mails
    const d1 = tag(1);
    let gesendet = 0;
    for (let i = 0; i < 4; i++) gesendet += (await m.loop.runSendTick({ sender, pruefer, now: new Date(d1.getTime() + i * 10 * 60_000), zufall })).sent;
    expect(gesendet).toBe(2);
  });
});

describe('Text-Kampagne (ohne Video)', () => {
  it('versendet ohne Rendern und ohne Video-Link', async () => {
    const k = neueKampagne({ mitVideo: false, emailBodyTemplate: '{{begruessung}},\n\nText ohne Video. {{video_link}}{{vorschaubild}}' });
    const l = neuerLead(k.id, { renderStatus: 'wartet' });
    const { gesendet, sender } = fakeSender();
    expect((await m.loop.runSendTick({ sender, now: T0, zufall })).sent).toBe(1);
    expect(lead(l.id).sendStatus).toBe('gesendet');
    expect(gesendet[0].raw).not.toContain('/v/');
  });
});

describe('Antwort-Erkennung', () => {
  const eigen = 'amin@prozessia.de';
  it('erkennt Antworten, ignoriert eigene Mails und Abwesenheitsnotizen', () => {
    expect(m.gmail.bewerteThread([{ from: 'Amin <amin@prozessia.de>' }], eigen)).toBeNull();
    expect(m.gmail.bewerteThread([{ from: eigen }, { from: 'Kunde <k@kunde.de>', 'auto-submitted': 'auto-replied' }], eigen)).toBeNull();
    expect(m.gmail.bewerteThread([{ from: eigen }, { from: 'Kunde <k@kunde.de>' }], eigen)).toBe('antwort');
  });
  it('erkennt Bounces', () => {
    expect(m.gmail.bewerteThread([{ from: eigen }, { from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>' }], eigen)).toBe('bounce');
  });
});

describe('Kampagne löschen', () => {
  it('entfernt Kampagne, Leads, Follow-ups, Versandprotokoll und Medien', async () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'x' }]);
    const l = neuerLead(k.id);
    const { sender } = fakeSender();
    await m.loop.runSendTick({ sender, pruefer: async () => null, now: T0, zufall });
    fs.writeFileSync(m.media.videoPath(l.slug), 'video');
    fs.writeFileSync(m.media.thumbnailPath(l.slug), 'bild');

    expect(m.campaigns.loescheKampagne(k.id)).toEqual({ leads: 1 });
    const { getDb, schema } = m.db;
    expect(getDb().select().from(schema.campaigns).where(eq(schema.campaigns.id, k.id)).get()).toBeUndefined();
    expect(getDb().select().from(schema.leads).where(eq(schema.leads.campaignId, k.id)).all()).toHaveLength(0);
    expect(getDb().select().from(schema.followups).where(eq(schema.followups.campaignId, k.id)).all()).toHaveLength(0);
    expect(getDb().select().from(schema.sentMessages).where(eq(schema.sentMessages.campaignId, k.id)).all()).toHaveLength(0);
    expect(fs.existsSync(m.media.videoPath(l.slug))).toBe(false);
    expect(fs.existsSync(m.media.thumbnailPath(l.slug))).toBe(false);
    expect(m.campaigns.loescheKampagne(k.id)).toBeNull();
  });
});

describe('Firmen-Duplikate in der Kampagne', () => {
  it('schließt weitere Kontakte je Firma aus und kann das rückgängig machen; Angeschriebene bleiben Original', () => {
    const k = neueKampagne();
    const a = neuerLead(k.id, { firma: 'Rittal GmbH', sendStatus: 'nicht_gesendet' });
    const b = neuerLead(k.id, { firma: 'Rittal GmbH & Co. KG', sendStatus: 'gesendet' });
    const c = neuerLead(k.id, { firma: 'Bosch AG', sendStatus: 'nicht_gesendet' });

    expect(m.campaigns.schliesseFirmenDuplikateAus(k.id)).toBe(1);
    // b wurde schon angeschrieben -> b ist das Original, a wird ausgeschlossen
    expect(lead(a.id)).toMatchObject({ sendStatus: 'uebersprungen', sendError: 'Firmen-Duplikat' });
    expect(lead(b.id).sendStatus).toBe('gesendet');
    expect(lead(c.id).sendStatus).toBe('nicht_gesendet');

    expect(m.campaigns.hebeFirmenDuplikateAuf(k.id)).toBe(1);
    expect(lead(a.id)).toMatchObject({ sendStatus: 'nicht_gesendet', sendError: null });
  });
});
