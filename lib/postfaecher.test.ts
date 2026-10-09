import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { legePostfachAn } from './test-postfach';

// Eigene Test-DB, bevor lib/db das erste Mal geöffnet wird
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-postfaecher-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
  SEND_MIN_GAP_MINUTES: '3',
  SEND_MAX_GAP_MINUTES: '9',
});

type Mods = {
  db: typeof import('./db');
  loop: typeof import('./send-loop');
  send: typeof import('./send');
  settings: typeof import('./settings');
  campaigns: typeof import('./campaigns');
  absender: typeof import('./absender');
  gmail: typeof import('./gmail');
  analyse: typeof import('./analyse');
};
let m: Mods;
let nr = 0;

// Mittwoch 11:00 Berlin
const T0 = new Date('2026-07-15T09:00:00Z');
const tag = (n: number) => new Date(T0.getTime() + n * 24 * 3600_000);
const nach = (ms: number) => new Date(T0.getTime() + ms);
const SEK = 1000;
const MIN = 60_000;
const zufall = () => 0; // Abstand = 3 min

type Gesendet = { postfachId: number; email: string; threadId?: string; raw: string };
function fakeSender(werfe?: (postfachId: number) => Error | null) {
  const gesendet: Gesendet[] = [];
  const sender = async (raw: string, threadId: string | undefined, postfach: { id: number; email: string }) => {
    const fehler = werfe?.(postfach.id);
    if (fehler) throw fehler;
    gesendet.push({ postfachId: postfach.id, email: postfach.email, threadId, raw: Buffer.from(raw, 'base64url').toString('utf8') });
    return { id: `m${gesendet.length}`, threadId: threadId ?? `t${nr}-${gesendet.length}` };
  };
  return { gesendet, sender };
}

function neueKampagne(extra: Partial<typeof import('@/db/schema').campaigns.$inferInsert> = {}) {
  const { getDb, schema } = m.db;
  return getDb()
    .insert(schema.campaigns)
    .values({
      name: 'Postfächer',
      ctaUrl: 'https://x.de',
      emailSubjectTemplate: 'Hallo {{firma}}',
      emailBodyTemplate: '{{begruessung}}\n\nViele Grüße\n{{absender_name}}',
      status: 'versendet_laufend',
      dailySendLimit: 100,
      mitVideo: false,
      ...extra,
    })
    .returning()
    .get();
}
function neuerLead(campaignId: number, extra: Partial<typeof import('@/db/schema').leads.$inferInsert> = {}) {
  const { getDb, schema } = m.db;
  nr++;
  return getDb()
    .insert(schema.leads)
    .values({ campaignId, firma: `Firma ${nr}`, email: `p${nr}@kunde.de`, slug: `pf-${nr}`, renderStatus: 'fertig', sendStatus: 'geplant', ...extra })
    .returning()
    .get();
}
const lead = (id: number) => m.db.getDb().select().from(m.db.schema.leads).where(eq(m.db.schema.leads.id, id)).get()!;
const postfach = (id: number) => m.db.getDb().select().from(m.db.schema.absender).where(eq(m.db.schema.absender.id, id)).get()!;
const von = (mime: string) => /^From: (.*)$/m.exec(mime)?.[1] ?? '';

beforeAll(async () => {
  m = {
    db: await import('./db'),
    loop: await import('./send-loop'),
    send: await import('./send'),
    settings: await import('./settings'),
    campaigns: await import('./campaigns'),
    absender: await import('./absender'),
    gmail: await import('./gmail'),
    analyse: await import('./analyse'),
  };
  m.db.getDb();
});

beforeEach(() => {
  // Jeder Test mit eigenen Postfächern und ohne laufende Kampagnen
  const { getDb, schema } = m.db;
  getDb().update(schema.campaigns).set({ status: 'pausiert' }).run();
  getDb().delete(schema.sentMessages).run();
  getDb().delete(schema.absender).run();
  m.settings.setSetting('global_daily_limit', '1000');
  m.settings.setSetting('rampe_aktiv', '0');
  m.settings.deleteSetting('rampe_beginn');
  m.settings.deleteSetting('signature');
  m.settings.deleteSetting('sender_name');
});

describe('Rotation über mehrere Postfächer', () => {
  it('rotiert Erstmails, der Abstand gilt je Postfach', async () => {
    const a = await legePostfachAn({ email: 'a@firma-a.de', name: 'Anna', signatur: 'Gruß aus A' });
    const b = await legePostfachAn({ email: 'b@firma-b.de', name: 'Bernd' });
    m.settings.setSetting('signature', 'Globale Signatur');
    const k = neueKampagne();
    const leads = [1, 2, 3, 4].map(() => neuerLead(k.id));
    const { gesendet, sender } = fakeSender();
    const tick = (now: Date) => m.loop.runSendTick({ sender, now, zufall });

    expect((await tick(T0)).sent).toBe(1); // A (gleicher Stand, kleinere ID)
    expect((await tick(nach(SEK))).sent).toBe(1); // A im Abstand -> B darf sofort
    const r3 = await tick(nach(2 * SEK));
    expect(r3.sent).toBe(0);
    expect(r3.waiting).toContain(`${k.id}:abstand`);
    expect((await tick(nach(3 * MIN))).sent).toBe(1); // A wieder frei (B noch nicht)
    expect((await tick(nach(3 * MIN + SEK))).sent).toBe(1); // B

    expect(gesendet.map((g) => g.postfachId)).toEqual([a.id, b.id, a.id, b.id]);
    expect(leads.map((l) => lead(l.id).absenderId)).toEqual([a.id, b.id, a.id, b.id]);
    const gezaehlt = m.db.getDb().select().from(m.db.schema.sentMessages).all().map((x) => x.absenderId);
    expect(gezaehlt).toEqual([a.id, b.id, a.id, b.id]);

    // MIME je Postfach: From mit Name, Message-ID-Domain, List-Unsubscribe-mailto, Signatur (eigene, sonst globale), {{absender_name}}
    expect(von(gesendet[0].raw)).toBe('"Anna" <a@firma-a.de>');
    expect(von(gesendet[1].raw)).toBe('"Bernd" <b@firma-b.de>');
    expect(gesendet[0].raw).toMatch(/^Message-ID: <[0-9a-f]+@firma-a\.de>$/m);
    expect(gesendet[1].raw).toMatch(/^Message-ID: <[0-9a-f]+@firma-b\.de>$/m);
    expect(gesendet[0].raw).toContain('mailto:a@firma-a.de?subject=Abmelden');
    expect(gesendet[1].raw).toContain('mailto:b@firma-b.de?subject=Abmelden');
    const text = (g: Gesendet) => {
      const teil = /Content-Type: text\/plain[^]*?\r\n\r\n([^]*?)\r\n--/.exec(g.raw)?.[1] ?? '';
      return Buffer.from(teil.replace(/\r\n/g, ''), 'base64').toString('utf8');
    };
    expect(text(gesendet[0])).toContain('Gruß aus A');
    expect(text(gesendet[0])).not.toContain('Globale Signatur');
    expect(text(gesendet[0])).toContain('Anna');
    expect(text(gesendet[1])).toContain('Globale Signatur');
    expect(text(gesendet[1])).toContain('Bernd');
  });

  it('Follow-ups und Antwortprüfung laufen über das Postfach der Erstmail', async () => {
    const a = await legePostfachAn({ email: 'a@firma-a.de' });
    const b = await legePostfachAn({ email: 'b@firma-b.de' });
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'Kurz nachgehakt' }]);
    const leads = [1, 2, 3].map(() => neuerLead(k.id));
    const erst = fakeSender();
    for (const [i, ms] of [0, SEK, 3 * MIN].entries()) {
      expect((await m.loop.runSendTick({ sender: erst.sender, pruefer: async () => null, now: nach(ms), zufall })).sent).toBe(1);
      expect(i).toBeLessThan(3);
    }
    const besitzer = new Map(leads.map((l) => [l.id, lead(l.id).absenderId!]));
    expect([...besitzer.values()]).toEqual([a.id, b.id, a.id]);

    // Nach 2 Tagen: alle drei Follow-ups, jedes über „sein“ Postfach – auch wenn ein anderes weniger Mails hat
    const fu = fakeSender();
    const geprueft: { threadId: string; postfachId: number }[] = [];
    const pruefer = async (threadId: string, p: { id: number }) => {
      geprueft.push({ threadId, postfachId: p.id });
      return null;
    };
    for (let i = 0; i < 12; i++) await m.loop.runSendTick({ sender: fu.sender, pruefer, now: new Date(tag(2).getTime() + i * 10 * MIN), zufall });
    expect(fu.gesendet).toHaveLength(3);
    for (const g of fu.gesendet) {
      const l = leads.find((x) => lead(x.id).gmailThreadId === g.threadId)!;
      expect(g.postfachId).toBe(besitzer.get(l.id));
      expect(von(g.raw)).toContain(postfach(g.postfachId).email);
      expect(g.raw).toContain(`In-Reply-To: ${lead(l.id).rfcMessageId}`);
    }
    // Antwortprüfung (vor dem Follow-up und im Hintergrund): immer im Postfach der Erstmail
    const eigene = geprueft.filter((p) => leads.some((x) => lead(x.id).gmailThreadId === p.threadId));
    expect(eigene.length).toBeGreaterThanOrEqual(3);
    for (const p of eigene) expect(p.postfachId).toBe(besitzer.get(leads.find((x) => lead(x.id).gmailThreadId === p.threadId)!.id));
    expect(leads.every((l) => lead(l.id).followupsSent === 1)).toBe(true);
    // Follow-ups zählen im Tageslimit des Postfachs mit
    const sentMsgs = m.db.getDb().select().from(m.db.schema.sentMessages).all().filter((x) => x.step === 1);
    expect(sentMsgs.map((x) => x.absenderId).sort()).toEqual([a.id, a.id, b.id].sort());
  });

  it('Follow-up wartet, wenn das Postfach der Erstmail pausiert, getrennt oder fehlerhaft ist – nie über ein anderes', async () => {
    const a = await legePostfachAn({ email: 'a@firma-a.de' });
    const b = await legePostfachAn({ email: 'b@firma-b.de' });
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'Kurz nachgehakt' }]);
    const l = neuerLead(k.id);
    const pruefer = async () => null;
    await m.loop.runSendTick({ sender: fakeSender().sender, pruefer, now: T0, zufall });
    expect(lead(l.id).absenderId).toBe(a.id);

    const { gesendet, sender } = fakeSender();
    const ausfaelle: Array<[string, () => void, () => void]> = [
      ['pausiert', () => m.absender.aktualisiereAbsender(a.id, { aktiv: false }), () => m.absender.aktualisiereAbsender(a.id, { aktiv: true })],
      ['Fehler', () => m.absender.markiereAuthFehler(a.id, 'invalid_grant'), () => m.db.getDb().update(m.db.schema.absender).set({ fehler: null }).where(eq(m.db.schema.absender.id, a.id)).run()],
      ['Quota', () => m.absender.stoppeQuota(a.id, tag(2)), () => m.db.getDb().update(m.db.schema.absender).set({ quotaGestopptAm: null }).where(eq(m.db.schema.absender.id, a.id)).run()],
    ];
    for (const [name, aus, an] of ausfaelle) {
      aus();
      const r = await m.loop.runSendTick({ sender, pruefer, now: tag(2), zufall });
      expect(r.sent, name).toBe(0);
      expect(gesendet, name).toHaveLength(0);
      expect(r.waiting.length, name).toBeGreaterThan(0);
      an();
    }
    // Entfernt (getrennt, Eintrag bleibt wegen des Leads): wartet ebenfalls
    expect(m.absender.entferneAbsender(a.id)).toBe('getrennt');
    expect(postfach(a.id)).toMatchObject({ refreshTokenEnc: '', aktiv: false });
    const r = await m.loop.runSendTick({ sender, pruefer, now: tag(2), zufall });
    expect(r.sent).toBe(0);
    expect(r.waiting).toContain(`${k.id}:followup_postfach_nicht_verfuegbar`);
    expect(gesendet).toHaveLength(0);
    expect(gesendet.some((g) => g.postfachId === b.id)).toBe(false);

    // Neu verbunden (gleiche Adresse): das Follow-up geht über das ursprüngliche Postfach raus
    m.absender.speichereVerbindung({ email: 'a@firma-a.de', refreshTokenEnc: 'neu', scopes: 'x' });
    expect(postfach(a.id)).toMatchObject({ aktiv: true, refreshTokenEnc: 'neu' });
    const mitLeseRecht = { sender, pruefer, now: tag(2), zufall };
    expect((await m.loop.runSendTick(mitLeseRecht)).sent).toBe(1);
    expect(gesendet[0].postfachId).toBe(a.id);
  });

  it('Quota-Fehler stoppt nur das betroffene Postfach, der Lead geht über ein anderes raus', async () => {
    const a = await legePostfachAn({ email: 'a@firma-a.de' });
    const b = await legePostfachAn({ email: 'b@firma-b.de' });
    const k = neueKampagne();
    const l = neuerLead(k.id);
    const quota = new m.gmail.GmailSendError({ art: 'quota', meldung: 'rateLimitExceeded' });
    const { gesendet, sender } = fakeSender((id) => (id === a.id ? quota : null));

    const r1 = await m.loop.runSendTick({ sender, now: T0, zufall });
    expect(r1.sent).toBe(0);
    expect(r1.waiting).toContain(`${k.id}:quota_gestoppt`);
    expect(postfach(a.id).quotaGestopptAm).toBe('2026-07-15');
    expect(postfach(b.id).quotaGestopptAm).toBeNull();
    expect(lead(l.id).sendStatus).toBe('geplant');

    // Nächster Durchlauf: A ist gestoppt, B sendet
    const r2 = await m.loop.runSendTick({ sender, now: nach(5 * SEK), zufall });
    expect(r2.sent).toBe(1);
    expect(gesendet.map((g) => g.postfachId)).toEqual([b.id]);
    expect(lead(l.id).absenderId).toBe(b.id);

    // Am nächsten Tag ist A wieder frei
    const l2 = neuerLead(k.id);
    const r3 = await m.loop.runSendTick({ sender: fakeSender().sender, now: tag(1), zufall });
    expect(r3.sent).toBe(1);
    expect(lead(l2.id).absenderId).toBe(a.id);
  });

  it('Auth-Fehler markiert nur das Postfach und pausiert es bis zum Neu-Verbinden', async () => {
    const a = await legePostfachAn({ email: 'a@firma-a.de' });
    const b = await legePostfachAn({ email: 'b@firma-b.de' });
    const k = neueKampagne();
    const l1 = neuerLead(k.id);
    const l2 = neuerLead(k.id);
    const auth = new m.gmail.GmailSendError({ art: 'auth', meldung: 'invalid_grant' });
    const kaputt = fakeSender((id) => (id === a.id ? auth : null));

    const r1 = await m.loop.runSendTick({ sender: kaputt.sender, now: T0, zufall });
    expect(r1.sent).toBe(0);
    expect(r1.error).toContain('invalid_grant');
    expect(postfach(a.id).fehler).toContain('invalid_grant');
    expect(lead(l1.id).sendStatus).toBe('geplant'); // kein Lead-Fehler

    const ok = fakeSender();
    expect((await m.loop.runSendTick({ sender: ok.sender, now: nach(SEK), zufall })).sent).toBe(1);
    expect((await m.loop.runSendTick({ sender: ok.sender, now: nach(3 * MIN + 2 * SEK), zufall })).sent).toBe(1);
    expect(ok.gesendet.map((g) => g.postfachId)).toEqual([b.id, b.id]); // A bleibt außen vor
    expect([l1, l2].map((l) => lead(l.id).absenderId)).toEqual([b.id, b.id]);

    // Neu verbinden hebt den Fehler auf
    m.absender.speichereVerbindung({ email: 'a@firma-a.de', refreshTokenEnc: 'neu', scopes: 'x' });
    expect(postfach(a.id).fehler).toBeNull();
  });

  it('Tageslimit je Postfach: volle Postfächer werden übergangen, danach wartet alles', async () => {
    const a = await legePostfachAn({ email: 'a@firma-a.de', tageslimit: 1 });
    const b = await legePostfachAn({ email: 'b@firma-b.de', tageslimit: 2 });
    const k = neueKampagne();
    for (let i = 0; i < 5; i++) neuerLead(k.id);
    const { gesendet, sender } = fakeSender();
    const waiting: string[] = [];
    for (let i = 0; i < 6; i++) waiting.push(...(await m.loop.runSendTick({ sender, now: nach(i * 10 * MIN), zufall })).waiting);

    expect(gesendet.map((g) => g.postfachId)).toEqual([a.id, b.id, b.id]);
    expect(waiting).toContain(`${k.id}:limit_postfach`);
    // Am nächsten Tag geht es weiter
    expect((await m.loop.runSendTick({ sender, now: tag(1), zufall })).sent).toBe(1);
  });

  it('Gesamtlimit über alle Postfächer bleibt Obergrenze', async () => {
    await legePostfachAn({ email: 'a@firma-a.de' });
    await legePostfachAn({ email: 'b@firma-b.de' });
    m.settings.setSetting('global_daily_limit', '2');
    const k = neueKampagne();
    for (let i = 0; i < 4; i++) neuerLead(k.id);
    const { gesendet, sender } = fakeSender();
    const waiting: string[] = [];
    for (let i = 0; i < 4; i++) waiting.push(...(await m.loop.runSendTick({ sender, now: nach(i * 10 * MIN), zufall })).waiting);
    expect(gesendet).toHaveLength(2);
    expect(waiting).toContain(`${k.id}:limit_global`);
  });

  it('Rampe gilt je Postfach (Beginn: eigene Einstellung, sonst erste Mail des Postfachs, sonst heute)', async () => {
    const a = await legePostfachAn({ email: 'a@firma-a.de', rampeBeginn: '2026-07-13' });
    const b = await legePostfachAn({ email: 'b@firma-b.de' });
    const c = await legePostfachAn({ email: 'c@firma-c.de' });
    const k = neueKampagne();
    const l = neuerLead(k.id);
    m.db.getDb().insert(m.db.schema.sentMessages).values({ leadId: l.id, campaignId: k.id, step: 0, absenderId: b.id, sentAt: new Date('2026-07-14T09:00:00Z') }).run();
    m.settings.setSetting('rampe_aktiv', '1');
    m.settings.setSetting('rampe_start', '2');
    m.settings.setSetting('rampe_schritt', '1');
    const limit = (id: number) => m.absender.ladePostfachZustaende(T0).find((x) => x.absender.id === id)!.zustand.limit;
    expect(limit(a.id)).toBe(4); // 2 Tage seit 13.07.
    expect(limit(b.id)).toBe(3); // 1 Tag seit erster Mail am 14.07.
    expect(limit(c.id)).toBe(2); // noch nichts gesendet -> heute
  });

  it('„Jetzt senden“ wählt per Rotation (ignoriert den Abstand) und sendet nicht über getrennte Postfächer', async () => {
    const a = await legePostfachAn({ email: 'a@firma-a.de' });
    const b = await legePostfachAn({ email: 'b@firma-b.de' });
    const k = neueKampagne();
    const l1 = neuerLead(k.id);
    const l2 = neuerLead(k.id);
    const { gesendet, sender } = fakeSender();
    expect((await m.send.sendLead(l1.id, { sender, now: T0 })).ok).toBe(true);
    m.absender.setzeNaechstenVersand(a.id, T0.getTime() + 10 * MIN);
    // A hat 1 Mail heute und Abstand, B 0 -> B
    expect((await m.send.sendLead(l2.id, { sender, now: nach(SEK) })).ok).toBe(true);
    expect(gesendet.map((g) => g.postfachId)).toEqual([a.id, b.id]);

    const l3 = neuerLead(k.id);
    m.absender.aktualisiereAbsender(a.id, { aktiv: false });
    m.absender.aktualisiereAbsender(b.id, { aktiv: false });
    expect(await m.send.sendLead(l3.id, { sender, now: nach(2 * SEK) })).toMatchObject({ ok: false, kind: 'kein_postfach' });
  });
});

describe('Verwaltung der Postfächer', () => {
  it('speichereVerbindung: neue Adresse legt an, gleiche Adresse aktualisiert den Token', () => {
    const n = m.absender.speichereVerbindung({ email: 'Neu@Firma.de', refreshTokenEnc: 't1', scopes: 's1' });
    expect(n.neu).toBe(true);
    expect(n.absender).toMatchObject({ email: 'neu@firma.de', refreshTokenEnc: 't1', aktiv: true, tageslimit: 30 });
    m.absender.aktualisiereAbsender(n.absender.id, { aktiv: false, name: 'Neu' });
    m.absender.markiereAuthFehler(n.absender.id, 'kaputt');
    const w = m.absender.speichereVerbindung({ email: 'neu@firma.de', refreshTokenEnc: 't2', scopes: 's2' });
    expect(w.neu).toBe(false);
    expect(w.absender).toMatchObject({ id: n.absender.id, refreshTokenEnc: 't2', scopes: 's2', fehler: null, aktiv: false, name: 'Neu' });
    expect(m.absender.ladeAbsender()).toHaveLength(1);
  });

  it('entferneAbsender löscht ohne Zuordnung, trennt sonst nur (Token weg, Eintrag bleibt)', async () => {
    const frei = await legePostfachAn({ email: 'frei@firma.de' });
    const belegt = await legePostfachAn({ email: 'belegt@firma.de' });
    const k = neueKampagne();
    const l = neuerLead(k.id, { sendStatus: 'gesendet', absenderId: belegt.id });
    expect(m.absender.entferneAbsender(frei.id)).toBe('geloescht');
    expect(m.absender.ladeAbsenderMitId(frei.id)).toBeNull();
    expect(m.absender.entferneAbsender(belegt.id)).toBe('getrennt');
    expect(postfach(belegt.id)).toMatchObject({ refreshTokenEnc: '', scopes: '', aktiv: false });
    expect(lead(l.id).absenderId).toBe(belegt.id);
    expect(m.absender.entferneAbsender(9999)).toBeNull();
  });

  it('handleCallbackCode speichert die Adresse aus dem ID-Token und verschlüsselt den Token', async () => {
    const { decrypt } = await import('./crypto');
    const r = await m.gmail.handleCallbackCode('code', async () => ({ refreshToken: 'geheim', scopes: 'a b', email: 'konto@firma.de' }));
    expect(r).toEqual({ email: 'konto@firma.de', neu: true });
    const row = m.absender.ladeAbsender().find((a) => a.email === 'konto@firma.de')!;
    expect(row.refreshTokenEnc).not.toContain('geheim');
    expect(decrypt(row.refreshTokenEnc)).toBe('geheim');
    expect(m.absender.kannAntwortenPruefen({ ...row, scopes: m.gmail.GMAIL_METADATA_SCOPE })).toBe(true);
    expect(m.absender.kannAntwortenPruefen(row)).toBe(false);
  });
});

describe('Analyse je Postfach', () => {
  it('zählt gesendete Mails und Antworten je Postfach', () => {
    const l = (id: number, absenderId: number | null, antwort = false) => ({
      id,
      mitVideo: false,
      sendStatus: 'gesendet',
      flowStopp: antwort ? 'beantwortet' : null,
      unsubscribed: false,
      leadStatus: 'offen',
      antwortAt: antwort ? 1 : null,
      flowStoppAt: null,
      absenderId,
    });
    const v = (leadId: number, step: number, absenderId: number | null) => ({ leadId, step, sentAt: 1, absenderId });
    const z = m.analyse.aggregierePostfaecher([l(1, 2, true), l(2, 1), l(3, 1, true), l(4, null)], [v(1, 0, 2), v(2, 0, 1), v(2, 1, 1), v(3, 0, 1), v(4, 0, null)]);
    expect(z).toEqual([
      { absenderId: 1, gesendet: 3, erstmails: 2, antworten: 1, antwortRate: 0.5 },
      { absenderId: 2, gesendet: 1, erstmails: 1, antworten: 1, antwortRate: 1 },
      { absenderId: null, gesendet: 1, erstmails: 1, antworten: 0, antwortRate: 0 },
    ]);
  });
});
