import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { legePostfachAn } from './test-postfach';

// Kein echtes Netz: nodemailer und imapflow werden ersetzt; der Zustand steuert, was sie melden
const netz = vi.hoisted(() => ({
  smtp: { fehler: null as unknown },
  imap: { fehler: null as unknown, verbindungen: 0 },
  transportOptionen: [] as unknown[],
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: (opt: unknown) => {
      netz.transportOptionen.push(opt);
      return {
        verify: async () => {
          if (netz.smtp.fehler) throw netz.smtp.fehler;
          return true;
        },
        sendMail: async () => ({}),
        close: () => {},
      };
    },
  },
}));
vi.mock('imapflow', () => ({
  ImapFlow: class {
    on() {}
    close() {}
    async connect() {
      netz.imap.verbindungen++;
      if (netz.imap.fehler) throw netz.imap.fehler;
    }
    async logout() {}
    async list() {
      return [];
    }
    async getMailboxLock() {
      return { release() {} };
    }
    async search() {
      return [];
    }
  },
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-absender-routen-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'r'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
});

const cookies: Record<'admin' | 'mitglied' | 'lesen', string> = { admin: '', mitglied: '', lesen: '' };
const GEHEIM_SMTP = 'route-geheim-smtp-1';
const GEHEIM_IMAP = 'route-geheim-imap-2';
const BODY = {
  email: 'info@strato-kunde.de',
  name: 'Info',
  smtpHost: 'smtp.strato.de',
  smtpPort: 465,
  smtpSicherheit: 'ssl',
  smtpPasswort: GEHEIM_SMTP,
  imapHost: 'imap.strato.de',
  imapPort: 993,
  imapSicherheit: 'ssl',
  imapPasswort: GEHEIM_IMAP,
};

beforeAll(async () => {
  const db = await import('./db');
  const auth = await import('./auth');
  const ph = '0'.repeat(32) + ':' + '0'.repeat(128);
  for (const rolle of ['admin', 'mitglied', 'lesen'] as const) {
    const b = db.getDb().insert(db.schema.benutzer).values({ email: `${rolle}@x.de`, name: rolle, passwortHash: ph, rolle }).returning().get();
    cookies[rolle] = `vo_session=${await auth.createSessionToken('r'.repeat(32), Date.now(), { benutzerId: b.id, rolle, version: b.sessionVersion })}`;
  }
});

const req = (methode: string, rolle: keyof typeof cookies | null, body?: unknown) =>
  new Request('https://video.example.de/api/absender', { method: methode, headers: { 'content-type': 'application/json', ...(rolle ? { cookie: cookies[rolle] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const idCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const zeile = async (email: string) => {
  const { getDb, schema } = await import('./db');
  return getDb().select().from(schema.absender).where(eq(schema.absender.email, email)).get();
};

describe('POST /api/absender (SMTP/IMAP-Postfach anlegen)', () => {
  it('nur Admin: ohne Login 401, „lesen“ und „mitglied“ 403 – und es wird nichts angelegt', async () => {
    const { POST } = await import('../app/api/absender/route');
    expect((await POST(req('POST', null, BODY))).status).toBe(401);
    expect((await POST(req('POST', 'lesen', BODY))).status).toBe(403);
    expect((await POST(req('POST', 'mitglied', BODY))).status).toBe(403);
    expect(await zeile(BODY.email)).toBeUndefined();
  });

  it('Admin legt an (201); Antwort ohne Passwörter; Passwörter verschlüsselt in der DB', async () => {
    const { POST } = await import('../app/api/absender/route');
    const res = await POST(req('POST', 'admin', BODY));
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(GEHEIM_SMTP);
    expect(text).not.toContain(GEHEIM_IMAP);
    expect(JSON.parse(text)).toMatchObject({ ok: true, absender: { email: BODY.email } });
    const z = await zeile(BODY.email);
    expect(z).toMatchObject({ typ: 'smtp', smtpHost: 'smtp.strato.de', imapHost: 'imap.strato.de' });
    expect(JSON.stringify(z)).not.toContain(GEHEIM_SMTP);
    const { entschluesseleZugangsdaten } = await import('./zugangsdaten');
    expect(entschluesseleZugangsdaten(z!.zugangsdatenEnc)).toEqual({ smtpPasswort: GEHEIM_SMTP, imapPasswort: GEHEIM_IMAP });
  });

  it('ungültige Eingaben → 400 mit Meldung, doppelte Adresse → 409', async () => {
    const { POST } = await import('../app/api/absender/route');
    const schlecht = await POST(req('POST', 'admin', { ...BODY, email: 'neu@x.de', smtpHost: 'http://böse/' }));
    expect(schlecht.status).toBe(400);
    expect((await schlecht.json()).error).toMatch(/Ungültige Eingabe/);
    const doppelt = await POST(req('POST', 'admin', BODY));
    expect(doppelt.status).toBe(409);
    expect((await doppelt.json()).error).toMatch(/existiert bereits/);
  });
});

describe('PATCH /api/absender/[id]', () => {
  it('Bearbeiten ohne Passwort überschreibt die gespeicherten nicht; Antwort ohne Passwörter; nur Admin', async () => {
    const { PATCH } = await import('../app/api/absender/[id]/route');
    const vorher = (await zeile(BODY.email))!;
    expect((await PATCH(req('PATCH', 'mitglied', { smtpHost: 'evil.example' }), idCtx(vorher.id))).status).toBe(403);
    expect((await zeile(BODY.email))!.smtpHost).toBe('smtp.strato.de');
    const res = await PATCH(req('PATCH', 'admin', { name: 'Neu', tageslimit: 12, smtpHost: 'smtp.neu.strato.de', smtpPasswort: '', imapPasswort: '' }), idCtx(vorher.id));
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(GEHEIM_SMTP);
    const danach = (await zeile(BODY.email))!;
    expect(danach.zugangsdatenEnc).toBe(vorher.zugangsdatenEnc);
    expect(danach).toMatchObject({ name: 'Neu', tageslimit: 12, smtpHost: 'smtp.neu.strato.de' });
    // mit neuem Passwort wird ersetzt
    await PATCH(req('PATCH', 'admin', { smtpPasswort: 'ganz-neu' }), idCtx(vorher.id));
    const { entschluesseleZugangsdaten } = await import('./zugangsdaten');
    expect(entschluesseleZugangsdaten((await zeile(BODY.email))!.zugangsdatenEnc)).toEqual({ smtpPasswort: 'ganz-neu', imapPasswort: GEHEIM_IMAP });
  });

  it('SMTP-Felder bei einem Gmail-Postfach → 400', async () => {
    const { PATCH } = await import('../app/api/absender/[id]/route');
    const g = await legePostfachAn({ email: 'gmail-route@x.de' });
    const res = await PATCH(req('PATCH', 'admin', { smtpHost: 'x.de' }), idCtx(g.id));
    expect(res.status).toBe(400);
    expect((await PATCH(req('PATCH', 'admin', { name: 'Nur Name' }), idCtx(g.id))).status).toBe(200);
  });

  it('Entfernen eines SMTP-Postfachs braucht Admin und widerruft nichts bei Google', async () => {
    const { DELETE } = await import('../app/api/absender/[id]/route');
    const z = (await zeile(BODY.email))!;
    expect((await DELETE(req('DELETE', 'mitglied'), idCtx(z.id))).status).toBe(403);
    const res = await DELETE(req('DELETE', 'admin'), idCtx(z.id));
    expect(res.status).toBe(200);
    expect(await zeile(BODY.email)).toBeUndefined();
  });
});

describe('POST /api/absender/verbindungstest', () => {
  const test = { email: 'info@test.de', smtpHost: 'smtp.gibt-es-nicht.invalid', smtpPort: 587, smtpSicherheit: 'starttls', smtpPasswort: 'pw-test-9', imapHost: 'imap.gibt-es-nicht.invalid', imapPort: 993, imapSicherheit: 'ssl' };

  it('nur Admin', async () => {
    const { POST } = await import('../app/api/absender/verbindungstest/route');
    expect((await POST(req('POST', null, test))).status).toBe(401);
    expect((await POST(req('POST', 'lesen', test))).status).toBe(403);
    expect((await POST(req('POST', 'mitglied', test))).status).toBe(403);
  });

  it('nicht erreichbarer Host → verständliche deutsche Fehler je Teil, kein Passwort in der Antwort, nichts gespeichert', async () => {
    const { POST } = await import('../app/api/absender/verbindungstest/route');
    netz.smtp.fehler = Object.assign(new Error('getaddrinfo ENOTFOUND smtp.gibt-es-nicht.invalid'), { code: 'EDNS' });
    netz.imap.fehler = Object.assign(new Error('getaddrinfo ENOTFOUND imap.gibt-es-nicht.invalid'), { code: 'ENOTFOUND' });
    const res = await POST(req('POST', 'admin', test));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('pw-test-9');
    const j = JSON.parse(text);
    expect(j.ok).toBe(false);
    expect(j.smtp.meldung).toMatch(/Keine Verbindung zum SMTP-Server/);
    expect(j.imap.meldung).toMatch(/Keine Verbindung zum IMAP-Server/);
    expect(await zeile('info@test.de')).toBeUndefined();
  });

  it('Anmeldung ok → ok:true; STARTTLS wird für SMTP erzwungen (requireTLS), Zeitlimits sind gesetzt', async () => {
    const { POST } = await import('../app/api/absender/verbindungstest/route');
    netz.smtp.fehler = null;
    netz.imap.fehler = null;
    netz.transportOptionen.length = 0;
    const j = await (await POST(req('POST', 'admin', test))).json();
    expect(j).toMatchObject({ ok: true, smtp: { ok: true }, imap: { ok: true } });
    expect(netz.transportOptionen[0]).toMatchObject({ host: 'smtp.gibt-es-nicht.invalid', port: 587, secure: false, requireTLS: true, ignoreTLS: false });
    expect((netz.transportOptionen[0] as { connectionTimeout: number }).connectionTimeout).toBeLessThanOrEqual(20_000);
  });

  it('fehlende Angaben → 400 mit Hinweis; unbekanntes Postfach → 404', async () => {
    const { POST } = await import('../app/api/absender/verbindungstest/route');
    const a = await POST(req('POST', 'admin', { email: 'x@y.de' }));
    expect(a.status).toBe(400);
    expect((await a.json()).error).toMatch(/SMTP-Server/);
    expect((await POST(req('POST', 'admin', { absenderId: 99999 }))).status).toBe(404);
  });

  it('mit absenderId und leerem Passwortfeld werden die gespeicherten Passwörter genutzt (aber nie zurückgegeben)', async () => {
    const neu = await import('../app/api/absender/route');
    await neu.POST(req('POST', 'admin', { ...BODY, email: 'gespeichert@x.de' }));
    const z = (await zeile('gespeichert@x.de'))!;
    const { POST } = await import('../app/api/absender/verbindungstest/route');
    netz.smtp.fehler = null;
    netz.imap.fehler = null;
    const res = await POST(req('POST', 'admin', { absenderId: z.id, smtpPasswort: '', imapPasswort: '' }));
    const text = await res.text();
    expect(JSON.parse(text).ok).toBe(true);
    expect(text).not.toContain(GEHEIM_SMTP);
  });
});

describe('Einstellungs-API', () => {
  it('GET /api/settings enthält keine Passwörter der SMTP-Postfächer', async () => {
    const { GET } = await import('../app/api/settings/route');
    const res = await GET(req('GET', 'lesen'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(GEHEIM_SMTP);
    expect(text).not.toContain(GEHEIM_IMAP);
    expect(text).not.toMatch(/zugangsdaten/i);
  });
});
