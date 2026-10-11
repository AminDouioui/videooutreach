import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GmailNachricht } from './mail-parse';
import { legePostfachAn } from './test-postfach';

// „Antwort senden“ in der Unibox und die Schreibregeln: bei Verstoß blockiert der Server (422), außer „trotzdem senden“;
// die Wahrheitsregel blockiert nicht; ausgeschaltet wird nichts geprüft.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-antw-sr-'));
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

type Mods = { db: typeof import('./db'); a: typeof import('./antworten'); settings: typeof import('./settings') };
let m: Mods;
let postfach: Awaited<ReturnType<typeof legePostfachAn>>;
let nr = 0;

const READ = 'https://www.googleapis.com/auth/gmail.readonly';
const SEND = 'https://www.googleapis.com/auth/gmail.send';
const b64u = (s: string) => Buffer.from(s).toString('base64url');
const nachricht = (id: string, kopf: Record<string, string>, text: string, ms: number): GmailNachricht => ({
  id,
  threadId: 'T1',
  internalDate: String(ms),
  payload: { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }, ...Object.entries(kopf).map(([name, value]) => ({ name, value }))], body: { data: b64u(text), size: text.length } },
});
const thread = (): GmailNachricht[] => [
  nachricht('g1', { From: postfach.email, To: 'max@kunde.de', Subject: 'Ihr Video', 'Message-ID': '<e1@prozessia.de>' }, 'Hallo Max.', 1_000),
  nachricht('g2', { From: 'Max <max@kunde.de>', To: postfach.email, Subject: 'Re: Ihr Video', 'Message-ID': '<k1@kunde.de>' }, 'Klingt gut.', 2_000),
];
function aufbau() {
  const gesendet: string[] = [];
  return { gesendet, lader: async () => thread(), sender: async (raw: string) => (gesendet.push(raw), { id: 's1', threadId: 'T1' }) };
}
async function neuerLead() {
  const { getDb, schema } = m.db;
  nr++;
  const k = getDb().insert(schema.campaigns).values({ name: `K${nr}`, ctaUrl: 'https://x.de', emailSubjectTemplate: 's', emailBodyTemplate: 'b' }).returning().get();
  return getDb().insert(schema.leads).values({ campaignId: k.id, firma: `F${nr}`, email: 'max@kunde.de', slug: `asr-${nr}`, sendStatus: 'gesendet', absenderId: postfach.id, gmailThreadId: 'T1', flowStopp: 'beantwortet' }).returning().get();
}

beforeAll(async () => {
  m = { db: await import('./db'), a: await import('./antworten'), settings: await import('./settings') };
  postfach = await legePostfachAn({ scopes: `${SEND} ${READ}`, name: 'Amin Douioui' });
});

describe('sendeAntwort und Schreibregeln', () => {
  it.each([
    ['Gedankenstrich', 'Dienstag passt – gern.'],
    ['Trenner', 'Dienstag passt - gern.'],
    ['Klammern', 'Dienstag (10 Uhr) passt.'],
  ])('%s: blockiert mit 422, Verstößen und ohne Gmail-Aufruf', async (_n, text) => {
    const lead = await neuerLead();
    const x = aufbau();
    const r = await m.a.sendeAntwort(lead.id, text, null, { lader: x.lader, sender: x.sender });
    expect(r).toMatchObject({ ok: false, status: 422 });
    if (r.ok) return;
    expect(r.error).toContain('verstößt gegen die Prozessia-Schreibregeln');
    expect(r.verstoesse?.length).toBeGreaterThan(0);
    expect(x.gesendet).toHaveLength(0);
  });

  it('Override trotzdem=true sendet', async () => {
    const lead = await neuerLead();
    const x = aufbau();
    const r = await m.a.sendeAntwort(lead.id, 'Dienstag passt – gern.', null, { lader: x.lader, sender: x.sender, trotzdem: true });
    expect(r.ok).toBe(true);
    expect(x.gesendet).toHaveLength(1);
  });

  it('sauberer Text, E-Mail und KI-gestützt gehen durch', async () => {
    const lead = await neuerLead();
    const x = aufbau();
    const r = await m.a.sendeAntwort(lead.id, 'Ich schicke Ihnen die KI-gestützte Auswertung per E-Mail. Passt Dienstag?', null, { lader: x.lader, sender: x.sender });
    expect(r.ok).toBe(true);
  });

  it('Wahrheitsregel blockiert beim Senden nicht (ein Gespräch kann stattgefunden haben)', async () => {
    const lead = await neuerLead();
    const x = aufbau();
    expect((await m.a.sendeAntwort(lead.id, 'Wie besprochen schicke ich Ihnen die Unterlagen.', null, { lader: x.lader, sender: x.sender })).ok).toBe(true);
  });

  it('Einstellung aus: keine Prüfung', async () => {
    m.settings.setSetting('schreibregeln_aktiv', '0');
    try {
      const lead = await neuerLead();
      const x = aufbau();
      expect((await m.a.sendeAntwort(lead.id, 'Dienstag (10 Uhr) – gern.', null, { lader: x.lader, sender: x.sender })).ok).toBe(true);
    } finally {
      m.settings.deleteSetting('schreibregeln_aktiv');
    }
  });

  it('leerer Text bleibt ein 400, vor der Regelprüfung', async () => {
    const lead = await neuerLead();
    expect(await m.a.sendeAntwort(lead.id, '  ', null)).toMatchObject({ ok: false, status: 400 });
  });
});

describe('antwortHandler', () => {
  const req = (body: unknown) => new Request('https://x/api', { method: 'POST', body: JSON.stringify(body) });

  it('liefert 422 mit schreibregeln:true und Verstößen; mit trotzdemSenden geht es durch', async () => {
    const lead = await neuerLead();
    const x = aufbau();
    const h = m.a.antwortHandler({ lader: x.lader, sender: x.sender });
    const ctx = { params: Promise.resolve({ id: String(lead.id) }) };
    const blockiert = await h(req({ text: 'Passt – gern.' }), ctx);
    expect(blockiert.status).toBe(422);
    const body = await blockiert.json();
    expect(body).toMatchObject({ ok: false, schreibregeln: true });
    expect(body.verstoesse[0]).toMatchObject({ regel: 'gedankenstrich' });
    expect(x.gesendet).toHaveLength(0);
    const frei = await h(req({ text: 'Passt – gern.', trotzdemSenden: true }), ctx);
    expect(frei.status).toBe(200);
    expect(x.gesendet).toHaveLength(1);
  });

  it('trotzdemSenden muss ein Boolean sein', async () => {
    const lead = await neuerLead();
    const h = m.a.antwortHandler({});
    const res = await h(req({ text: 'a', trotzdemSenden: 'ja' }), { params: Promise.resolve({ id: String(lead.id) }) });
    expect(res.status).toBe(400);
  });
});
