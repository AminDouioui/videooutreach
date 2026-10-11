import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { legePostfachAn } from './test-postfach';
import type { GmailNachricht } from './mail-parse';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-antworten-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'sec',
});

type Mods = {
  db: typeof import('./db');
  a: typeof import('./antworten');
  absender: typeof import('./absender');
  send: typeof import('./send');
  analyse: typeof import('./analyse');
  gmail: typeof import('./gmail');
  scopes: typeof import('./gmail-scopes');
};
let m: Mods;
let nr = 0;

const SEND = 'https://www.googleapis.com/auth/gmail.send';
const READ = 'https://www.googleapis.com/auth/gmail.readonly';
const b64u = (s: string) => Buffer.from(s).toString('base64url');
const nachricht = (id: string, kopf: Record<string, string>, text: string, ms: number): GmailNachricht => ({
  id,
  threadId: 'T1',
  internalDate: String(ms),
  payload: {
    mimeType: 'text/plain',
    headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }, ...Object.entries(kopf).map(([name, value]) => ({ name, value }))],
    body: { data: b64u(text), size: text.length },
  },
});
const eigeneMail = (adresse: string) => nachricht('g1', { From: adresse, To: 'max@kunde.de', Subject: 'Ihr Video', 'Message-ID': '<e1@prozessia.de>' }, 'Hallo Max, hier Ihr Video.', 1_000);
const kundenMail = (adresse: string) => nachricht(
  'g2',
  { From: 'Max Muster <max@kunde.de>', To: adresse, Subject: 'Re: Ihr Video', 'Message-ID': '<k1@kunde.de>', References: '<e1@prozessia.de>' },
  'Klingt gut, Dienstag passt.\n\nAm 1. Okt. 2026 um 10:00 Uhr schrieb Amin <amin@prozessia.de>:\n> Hallo Max, hier Ihr Video.',
  2_000,
);

function fakeLader(eigen: string, nachrichten: GmailNachricht[] = [eigeneMail(eigen), kundenMail(eigen)]) {
  const aufrufe: string[] = [];
  return { aufrufe, lader: async (threadId: string) => (aufrufe.push(threadId), nachrichten) };
}
function fakeSender(fehler?: Error) {
  const gesendet: { threadId: string | undefined; postfachId: number; mime: string }[] = [];
  const sender = async (raw: string, threadId: string | undefined, postfach: { id: number }) => {
    if (fehler) throw fehler;
    gesendet.push({ threadId, postfachId: postfach.id, mime: Buffer.from(raw, 'base64url').toString('utf8') });
    return { id: `s${gesendet.length}`, threadId: threadId ?? 'neu' };
  };
  return { gesendet, sender };
}
/** Alle text/plain- und text/html-Teile einer MIME-Nachricht dekodiert */
function teile(mime: string): string {
  return [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?:\r\n--|$)/g)].map((x) => Buffer.from(x[1].replace(/\s/g, ''), 'base64').toString('utf8')).join('\n----\n');
}

async function neuerLead(postfachId: number | null, extra: Partial<typeof import('@/db/schema').leads.$inferInsert> = {}) {
  const { getDb, schema } = m.db;
  nr++;
  const k = getDb().insert(schema.campaigns).values({ name: `K${nr}`, ctaUrl: 'https://x.de', emailSubjectTemplate: 'Ihr Video', emailBodyTemplate: 'b' }).returning().get();
  return getDb()
    .insert(schema.leads)
    .values({ campaignId: k.id, firma: `Firma ${nr}`, email: 'max@kunde.de', slug: `lead-${nr}`, sendStatus: 'gesendet', absenderId: postfachId, gmailThreadId: 'T1', flowStopp: 'beantwortet', antwortGelesen: false, ...extra })
    .returning()
    .get();
}

beforeAll(async () => {
  m = {
    db: await import('./db'),
    a: await import('./antworten'),
    absender: await import('./absender'),
    send: await import('./send'),
    analyse: await import('./analyse'),
    gmail: await import('./gmail'),
    scopes: await import('./gmail-scopes'),
  };
});
beforeEach(() => m.a.leereThreadCache());

describe('Scope & Postfach-Anzeige', () => {
  it('kannThreadLesen: nur mit gmail.readonly und Token; Basis-Scopes enthalten ihn nicht', async () => {
    const ohne = await legePostfachAn({ scopes: SEND });
    const mit = await legePostfachAn({ scopes: `${SEND} ${READ}` });
    const getrennt = await legePostfachAn({ scopes: `${SEND} ${READ}`, refreshTokenEnc: '' });
    expect(m.absender.kannThreadLesen(ohne)).toBe(false);
    expect(m.absender.kannThreadLesen(mit)).toBe(true);
    expect(m.absender.kannThreadLesen(getrennt)).toBe(false);
    expect(m.scopes.OAUTH_SCOPES).not.toContain(READ);
    expect(m.scopes.OAUTH_SCOPES_MIT_LESEZUGRIFF).toContain(READ);
  });
  it('OAuth-URL: Lesezugriff nur auf Wunsch, mit include_granted_scopes', () => {
    const basis = new URL(m.gmail.buildAuthUrl('s', 'a@b.de'));
    const mit = new URL(m.gmail.buildAuthUrl('s', 'a@b.de', true));
    expect(basis.searchParams.get('scope')).not.toContain('gmail.readonly');
    expect(mit.searchParams.get('scope')).toContain(READ);
    expect(mit.searchParams.get('scope')).toContain(SEND);
    expect(mit.searchParams.get('include_granted_scopes')).toBe('true');
    expect(mit.searchParams.get('access_type')).toBe('offline');
  });
  it('Verbindung speichert die von Google gelieferten Scopes (inkl. readonly)', async () => {
    const r = await m.gmail.handleCallbackCode('c', async () => ({ refreshToken: 'rt', scopes: `${SEND} ${READ} openid`, email: 'neu@prozessia.de' }));
    const p = m.absender.ladeAbsender().find((x) => x.email === r.email)!;
    expect(m.absender.kannThreadLesen(p)).toBe(true);
    // Erneut ohne readonly (Nutzer hat abgewählt) → Unibox wieder aus, Postfach bleibt nutzbar
    await m.gmail.handleCallbackCode('c', async () => ({ refreshToken: 'rt2', scopes: `${SEND} openid`, email: 'neu@prozessia.de' }));
    expect(m.absender.kannThreadLesen(m.absender.ladeAbsender().find((x) => x.email === r.email)!)).toBe(false);
  });
});

describe('ladeThread', () => {
  it('liefert Nachrichten mit eigene-Flag, getrenntem Zitat und puffert 60 s', async () => {
    const p = await legePostfachAn({ scopes: `${SEND} ${READ}` });
    const f = fakeLader(p.email);
    const t = await m.a.ladeThread(p, 'T1', { lader: f.lader, jetzt: 1_000_000 });
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ eigene: true, von: p.email, betreff: 'Ihr Video' });
    expect(t[1]).toMatchObject({ eigene: false, text: 'Klingt gut, Dienstag passt.', an: p.email });
    expect(t[1].zitat).toContain('> Hallo Max');
    await m.a.ladeThread(p, 'T1', { lader: f.lader, jetzt: 1_030_000 });
    expect(f.aufrufe).toHaveLength(1);
    await m.a.ladeThread(p, 'T1', { lader: f.lader, jetzt: 1_061_000 });
    expect(f.aufrufe).toHaveLength(2);
    await m.a.ladeThread(p, 'T1', { lader: f.lader, jetzt: 1_062_000, frisch: true });
    expect(f.aufrufe).toHaveLength(3);
    await m.a.ladeThread(p, 'T2', { lader: f.lader, jetzt: 1_062_000 });
    expect(f.aufrufe).toHaveLength(4);
  });
  it('ohne Lesezugriff: verständlicher Fehler, Gmail wird nicht gefragt', async () => {
    const p = await legePostfachAn({ scopes: SEND });
    const f = fakeLader(p.email);
    await expect(m.a.ladeThread(p, 'T1', { lader: f.lader })).rejects.toThrow(/Lesezugriff erteilen/);
    expect(f.aufrufe).toHaveLength(0);
  });
});

describe('Fehlertexte', () => {
  const G = (art: 'auth' | 'quota' | 'sonstig', meldung: string) => new m.gmail.GmailSendError({ art, meldung });
  it('invalid_grant, fehlende Berechtigung, Netz, nicht gefunden, Konfiguration', () => {
    expect(m.a.fehlerText(G('auth', 'Gmail-Authentifizierung fehlgeschlagen (bitte neu verbinden): invalid_grant'))).toMatch(/widerrufen oder ist abgelaufen.*Neu verbinden/);
    expect(m.a.fehlerText(G('auth', 'Gmail-Berechtigung fehlt: Request had insufficient authentication scopes'))).toMatch(/Lesezugriff erteilen/);
    expect(m.a.fehlerText(G('sonstig', 'Requested entity was not found.'))).toMatch(/nicht gefunden/);
    expect(m.a.fehlerText(new m.gmail.GmailSendError(m.gmail.classifyGmailError(Object.assign(new Error('getaddrinfo ENOTFOUND gmail.googleapis.com'), { code: 'ENOTFOUND' }))))).toMatch(/Keine Verbindung/);
    expect(m.a.fehlerText(new Error('GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET sind nicht gesetzt (siehe docs/gmail-einrichtung.md)'))).toMatch(/^Die Google-Zugangsdaten fehlen/);
    expect(m.a.fehlerText(new Error('kaputt'))).toBe('Unerwarteter Fehler: kaputt');
    expect(m.gmail.classifyGmailError({ code: 403, errors: [{ reason: 'insufficientPermissions' }], message: 'Insufficient Permission' }).art).toBe('auth');
  });
});

describe('sendeAntwort', () => {
  it('antwortet im Thread: Header, Betreff, Signatur, ohne Abmeldelink im Text; protokolliert mit step -1', async () => {
    const p = await legePostfachAn({ scopes: `${SEND} ${READ}`, name: 'Amin Douioui', signatur: 'Amin Douioui\nProzessia GmbH' });
    const lead = await neuerLead(p.id);
    const f = fakeLader(p.email);
    const s = fakeSender();
    const r = await m.a.sendeAntwort(lead.id, 'Dienstag 10 Uhr passt.\r\n\r\nBis dann', null, { lader: f.lader, sender: s.sender });
    expect(r).toMatchObject({ ok: true, threadId: 'T1' });
    expect(s.gesendet).toHaveLength(1);
    const g = s.gesendet[0];
    expect(g.threadId).toBe('T1');
    expect(g.postfachId).toBe(p.id);
    expect(g.mime).toContain('In-Reply-To: <k1@kunde.de>');
    expect(g.mime).toContain('References: <e1@prozessia.de> <k1@kunde.de>');
    expect(g.mime).toContain('Subject: Re: Ihr Video');
    expect(g.mime).toContain('To: max@kunde.de');
    expect(g.mime).toContain(`From: "Amin Douioui" <${p.email}>`);
    expect(g.mime).toContain('List-Unsubscribe: <https://video.example.de/api/unsubscribe/');
    const inhalt = teile(g.mime);
    expect(inhalt).toContain('Dienstag 10 Uhr passt.');
    expect(inhalt).toContain('-- \nAmin Douioui\nProzessia GmbH');
    expect(inhalt).not.toMatch(/abmelden/i);
    expect(inhalt).not.toContain('/api/o/'); // kein Tracking-Pixel
    expect(inhalt).not.toContain('Video ansehen');

    const { getDb, schema } = m.db;
    const zeilen = getDb().select().from(schema.sentMessages).where(eq(schema.sentMessages.leadId, lead.id)).all();
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({ step: -1, absenderId: p.id, gmailThreadId: 'T1', campaignId: lead.campaignId });
    expect(getDb().select().from(schema.leads).where(eq(schema.leads.id, lead.id)).get()!.antwortGelesen).toBe(true);
  });

  it('nutzt das Postfach des Leads, keine Rotation (auch wenn ein anderes weniger gesendet hat)', async () => {
    const p1 = await legePostfachAn({ scopes: `${SEND} ${READ}` });
    const p2 = await legePostfachAn({ scopes: `${SEND} ${READ}` });
    const lead = await neuerLead(p2.id);
    const s = fakeSender();
    // p2 hat heute mehr gesendet als p1 – die Rotation würde p1 wählen
    const { getDb, schema } = m.db;
    for (let i = 0; i < 3; i++) getDb().insert(schema.sentMessages).values({ leadId: lead.id, campaignId: lead.campaignId, step: 0, absenderId: p2.id }).run();
    const r = await m.a.sendeAntwort(lead.id, 'Ja', null, { lader: fakeLader(p2.email).lader, sender: s.sender });
    expect(r.ok).toBe(true);
    expect(s.gesendet[0].postfachId).toBe(p2.id);
    expect(p1.id).not.toBe(p2.id);
  });

  it('Empfänger: Reply-To der letzten fremden Nachricht; Systemadressen fallen auf die Lead-Adresse zurück', async () => {
    const p = await legePostfachAn({ scopes: `${SEND} ${READ}` });
    const lead = await neuerLead(p.id);
    const mitReplyTo = nachricht('g3', { From: 'max@kunde.de', 'Reply-To': 'Sekretariat <sek@kunde.de>', Subject: 'Hallo', 'Message-ID': '<k2@kunde.de>' }, 'Hi', 3_000);
    const s1 = fakeSender();
    await m.a.sendeAntwort(lead.id, 'x', null, { lader: fakeLader(p.email, [eigeneMail(p.email), mitReplyTo]).lader, sender: s1.sender });
    expect(s1.gesendet[0].mime).toContain('To: sek@kunde.de');
    const bounce = nachricht('g4', { From: 'MAILER-DAEMON@kunde.de', Subject: 'Undelivered', 'Message-ID': '<b@kunde.de>' }, 'fehlgeschlagen', 3_000);
    const s2 = fakeSender();
    await m.a.sendeAntwort(lead.id, 'x', null, { lader: fakeLader(p.email, [eigeneMail(p.email), bounce]).lader, sender: s2.sender });
    expect(s2.gesendet[0].mime).toContain('To: max@kunde.de');
  });

  it('Umlaute im Text und Betreff bleiben erhalten', async () => {
    const p = await legePostfachAn({ scopes: `${SEND} ${READ}` });
    const lead = await neuerLead(p.id);
    const k = nachricht('g5', { From: 'max@kunde.de', Subject: 'Größe & Preis', 'Message-ID': '<k3@kunde.de>' }, 'Hi', 3_000);
    const s = fakeSender();
    await m.a.sendeAntwort(lead.id, 'Schöne Grüße <b>fett</b>', null, { lader: fakeLader(p.email, [eigeneMail(p.email), k]).lader, sender: s.sender });
    expect(s.gesendet[0].mime).toContain('Subject: =?UTF-8?B?');
    const inhalt = teile(s.gesendet[0].mime);
    expect(inhalt).toContain('Schöne Grüße <b>fett</b>'); // Klartext unverändert
    expect(inhalt).toContain('&lt;b&gt;fett&lt;/b&gt;'); // HTML escaped
  });

  it('Fehlerfälle: leer, zu lang, unbekannter Lead, fremder Thread, ohne Lesezugriff, ohne Postfach', async () => {
    const p = await legePostfachAn({ scopes: `${SEND} ${READ}` });
    const lead = await neuerLead(p.id);
    const s = fakeSender();
    const opt = { lader: fakeLader(p.email).lader, sender: s.sender };
    expect(await m.a.sendeAntwort(lead.id, '  \n ', null, opt)).toMatchObject({ ok: false, status: 400 });
    expect(await m.a.sendeAntwort(lead.id, 'x'.repeat(20_001), null, opt)).toMatchObject({ ok: false, status: 400 });
    expect(await m.a.sendeAntwort(999_999, 'x', null, opt)).toMatchObject({ ok: false, status: 404 });
    expect(await m.a.sendeAntwort(lead.id, 'x', 'FREMD', opt)).toMatchObject({ ok: false, status: 400 });
    const ohne = await legePostfachAn({ scopes: SEND });
    const l2 = await neuerLead(ohne.id);
    expect(await m.a.sendeAntwort(l2.id, 'x', null, opt)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('Lesezugriff') });
    const l3 = await neuerLead(null, { sendStatus: 'nicht_gesendet', gmailThreadId: null });
    const r3 = await m.a.sendeAntwort(l3.id, 'x', null, opt);
    expect(r3.ok).toBe(false);
    expect(s.gesendet).toHaveLength(0);
  });

  it('Gmail-Fehler beim Senden: deutsche Meldung, nichts protokolliert, invalid_grant pausiert das Postfach', async () => {
    const p = await legePostfachAn({ scopes: `${SEND} ${READ}` });
    const lead = await neuerLead(p.id);
    const s = fakeSender(new m.gmail.GmailSendError({ art: 'auth', meldung: 'Gmail-Authentifizierung fehlgeschlagen (bitte neu verbinden): invalid_grant' }));
    const r = await m.a.sendeAntwort(lead.id, 'x', null, { lader: fakeLader(p.email).lader, sender: s.sender });
    expect(r).toMatchObject({ ok: false, status: 502, error: expect.stringContaining('widerrufen') });
    const { getDb, schema } = m.db;
    expect(getDb().select().from(schema.sentMessages).where(eq(schema.sentMessages.leadId, lead.id)).all()).toHaveLength(0);
    expect(m.absender.ladeAbsenderMitId(p.id)!.fehler).toContain('invalid_grant');
  });

  it('Lesefehler beim Antworten ändern den Versandzustand des Postfachs nicht', async () => {
    const p = await legePostfachAn({ scopes: `${SEND} ${READ}` });
    const lead = await neuerLead(p.id);
    const lader = async () => {
      throw new m.gmail.GmailSendError({ art: 'quota', meldung: 'Gmail-Limit erreicht: rateLimitExceeded' });
    };
    const r = await m.a.sendeAntwort(lead.id, 'x', null, { lader, sender: fakeSender().sender });
    expect(r.ok).toBe(false);
    expect(m.absender.ladeAbsenderMitId(p.id)).toMatchObject({ quotaGestopptAm: null, fehler: null });
  });
});

describe('Zählung: Antworten (step -1) sind keine Follow-ups und zählen nicht gegen Limits', () => {
  it('countSentToday, Postfach-Zähler, Rampe, Analyse', async () => {
    const p = await legePostfachAn({ scopes: `${SEND} ${READ}` });
    const lead = await neuerLead(p.id);
    const { getDb, schema } = m.db;
    const vorherK = m.send.countSentToday(lead.campaignId);
    const vorherG = m.send.countSentToday();
    const vorherP = m.absender.heuteGesendetProPostfach().get(p.id) ?? 0;
    const vorherErste = m.send.ersterVersandTag();
    await m.a.sendeAntwort(lead.id, 'Danke', null, { lader: fakeLader(p.email).lader, sender: fakeSender().sender });
    expect(getDb().select().from(schema.sentMessages).where(eq(schema.sentMessages.leadId, lead.id)).all()).toHaveLength(1);
    expect(m.send.countSentToday(lead.campaignId)).toBe(vorherK);
    expect(m.send.countSentToday()).toBe(vorherG);
    expect(m.send.countSentToday(lead.campaignId, new Date(), true)).toBe(0);
    expect(m.absender.heuteGesendetProPostfach().get(p.id) ?? 0).toBe(vorherP);
    expect(m.send.ersterVersandTag()).toBe(vorherErste);

    // Analyse: Erstmail + Antwort-Mail → nur die Erstmail zählt, kein „Follow-up -1“/„Follow-up 1“
    getDb().insert(schema.sentMessages).values({ leadId: lead.id, campaignId: lead.campaignId, step: 0, absenderId: p.id, sentAt: new Date(Date.now() - 3600_000) }).run();
    const an = m.analyse.ladeKampagnenAnalyse(lead.campaignId, 1);
    expect(an.schritte).toHaveLength(1);
    expect(an.schritte[0]).toMatchObject({ step: 0, gesendet: 1 });
    expect(an.trichter.gesendet).toBe(1);
    expect(m.send.countSentToday(lead.campaignId)).toBe(vorherK + 1);
  });
});

describe('Route-Handler mit injiziertem Gmail', () => {
  const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
  const post = (id: number | string, body: unknown, opt: Parameters<typeof m.a.antwortHandler>[0]) =>
    m.a.antwortHandler(opt)(new Request(`http://x/api/leads/${id}/antworten`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), ctx(id));

  it('POST: 200 und Mail im Thread', async () => {
    const p = await legePostfachAn({ scopes: `${SEND} ${READ}` });
    const lead = await neuerLead(p.id);
    const s = fakeSender();
    const res = await post(lead.id, { text: 'Hallo zurück' }, { lader: fakeLader(p.email).lader, sender: s.sender });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, threadId: 'T1' });
    expect(s.gesendet).toHaveLength(1);
  });
  it('POST: 400 bei ungültigem Body/leerem Text, 404 bei unbekanntem Lead, 409 ohne Lesezugriff', async () => {
    const p = await legePostfachAn({ scopes: SEND });
    const lead = await neuerLead(p.id);
    const opt = { lader: fakeLader(p.email).lader, sender: fakeSender().sender };
    expect((await post(lead.id, 'kein json', opt)).status).toBe(400);
    expect((await post(lead.id, { foo: 1 }, opt)).status).toBe(400);
    expect((await post(lead.id, { text: '' }, opt)).status).toBe(400);
    expect((await post('abc', { text: 'x' }, opt)).status).toBe(404);
    expect((await post(999_999, { text: 'x' }, opt)).status).toBe(404);
    const res = await post(lead.id, { text: 'x' }, opt);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/Lesezugriff/);
  });
  it('GET thread: Nachrichten; ohne Lesezugriff/mit Gmail-Fehler eine Meldung statt Absturz', async () => {
    const p = await legePostfachAn({ scopes: `${SEND} ${READ}` });
    const lead = await neuerLead(p.id);
    const get = (id: number, opt: Parameters<typeof m.a.threadHandler>[0], q = '') => m.a.threadHandler(opt)(new Request(`http://x/api/leads/${id}/thread${q}`), ctx(id));
    const ok = await get(lead.id, { lader: fakeLader(p.email).lader });
    expect(ok.status).toBe(200);
    const daten = (await ok.json()) as { ok: boolean; nachrichten: { eigene: boolean }[] };
    expect(daten.ok).toBe(true);
    expect(daten.nachrichten.map((n) => n.eigene)).toEqual([true, false]);
    // interne Kopfzeilen werden nicht ausgeliefert
    expect(JSON.stringify(daten)).not.toContain('k1@kunde.de');

    m.a.leereThreadCache();
    const kaputt = await get(lead.id, {
      lader: async () => {
        throw new m.gmail.GmailSendError({ art: 'auth', meldung: 'Gmail-Authentifizierung fehlgeschlagen (bitte neu verbinden): invalid_grant' });
      },
    });
    expect(kaputt.status).toBe(200);
    expect(await kaputt.json()).toMatchObject({ ok: false, error: expect.stringContaining('Neu verbinden') });

    const ohne = await legePostfachAn({ scopes: SEND });
    const l2 = await neuerLead(ohne.id);
    expect(await (await get(l2.id, { lader: fakeLader(p.email).lader })).json()).toMatchObject({ ok: false, error: expect.stringContaining('Lesezugriff') });
    expect((await get(lead.id, { lader: fakeLader(p.email).lader }, '?thread=FREMD')).status).toBe(400);
    expect((await get(999_999, {})).status).toBe(404);
  });
  it('leadThreads: Antwort-Thread wird vorausgewählt, mehrere Threads', async () => {
    const p = await legePostfachAn({ scopes: `${SEND} ${READ}` });
    const lead = await neuerLead(p.id, { antwortThreadId: 'T2' });
    const { getDb, schema } = m.db;
    getDb().insert(schema.sentMessages).values({ leadId: lead.id, campaignId: lead.campaignId, step: 1, gmailThreadId: 'T2', absenderId: p.id }).run();
    const t = m.a.leadThreads(lead);
    expect(t.threads).toEqual(['T1', 'T2']);
    expect(t.start).toBe(1);
    expect(t.lesezugriff).toBe(true);
  });
});
