import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-team-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'test-admin-passwort',
  SESSION_SECRET: 't'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
});

type Mods = {
  db: typeof import('./db');
  b: typeof import('./benutzer');
  auth: typeof import('./auth');
  session: typeof import('./session');
  login: typeof import('../app/api/auth/login/route');
  einl: typeof import('../app/api/einladung/[token]/route');
  benutzerListe: typeof import('../app/api/benutzer/route');
  benutzerEinl: typeof import('../app/api/benutzer/einladungen/route');
  benutzerEinlId: typeof import('../app/api/benutzer/einladungen/[id]/route');
  benutzerId: typeof import('../app/api/benutzer/[id]/route');
  reset: typeof import('../app/api/benutzer/[id]/passwort-zuruecksetzen/route');
  konto: typeof import('../app/api/konto/route');
};
let m: Mods;
let ipNr = 0;
const neueIp = () => `10.0.${Math.floor(++ipNr / 250)}.${ipNr % 250}`;
const PW = 'test-passwort-12345';
const URL_ = 'https://video.example.de';

beforeAll(async () => {
  m = {
    db: await import('./db'),
    b: await import('./benutzer'),
    auth: await import('./auth'),
    session: await import('./session'),
    login: await import('../app/api/auth/login/route'),
    einl: await import('../app/api/einladung/[token]/route'),
    benutzerListe: await import('../app/api/benutzer/route'),
    benutzerEinl: await import('../app/api/benutzer/einladungen/route'),
    benutzerEinlId: await import('../app/api/benutzer/einladungen/[id]/route'),
    benutzerId: await import('../app/api/benutzer/[id]/route'),
    reset: await import('../app/api/benutzer/[id]/passwort-zuruecksetzen/route'),
    konto: await import('../app/api/konto/route'),
  };
});

const json = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${URL_}${url}`, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': neueIp(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const cookieVon = (res: Response): string | null => {
  const sc = res.headers.get('set-cookie');
  const mm = sc?.match(/vo_session=([^;]*)/);
  return mm && mm[1] ? mm[1] : null;
};
const mitCookie = (token: string | null) => ({ cookie: `vo_session=${token ?? ''}` });

async function anmelden(email: string | undefined, password: string, ip = neueIp()) {
  return m.login.POST(json('/api/auth/login', 'POST', { email, password }, { 'x-forwarded-for': ip }) as never);
}
async function adminCookie() {
  const res = await anmelden(undefined, 'test-admin-passwort');
  return mitCookie(cookieVon(res));
}
/** Legt über den Einladungs-Weg einen Benutzer an und liefert Id, Cookie und Passwort */
async function legeBenutzerAn(email: string, rolle: 'admin' | 'mitglied' | 'lesen', name = 'Test Person') {
  const e = m.b.erstelleEinladungFuerNeuenBenutzer(email, rolle);
  if (!e.ok) throw new Error(e.fehler);
  const res = await m.einl.POST(json(`/api/einladung/${e.token}`, 'POST', { name, passwort: PW }), ctx({ token: e.token }));
  expect(res.status).toBe(200);
  const b = m.b.ladeBenutzerPerEmail(email)!;
  return { id: b.id, cookie: mitCookie(cookieVon(res)), token: e.token };
}

describe('Login', () => {
  it('Env-Admin: ohne E-Mail (leer/fehlend) mit ADMIN_PASSWORD, Rolle admin, Id 0', async () => {
    for (const email of [undefined, '', '   ']) {
      const res = await anmelden(email, 'test-admin-passwort');
      expect(res.status).toBe(200);
      const t = cookieVon(res)!;
      expect(t.split('.').slice(1, 4)).toEqual(['0', 'admin', '0']);
      const me = await m.session.benutzerAusToken(t);
      expect(me).toMatchObject({ id: 0, name: 'Admin', rolle: 'admin', envAdmin: true });
    }
    expect((await anmelden(undefined, 'falsch')).status).toBe(401);
  });

  it('Benutzer-Login: richtig, falsches Passwort, E-Mail unabhängig von Groß-/Kleinschreibung', async () => {
    await legeBenutzerAn('anna@firma.de', 'mitglied', 'Anna');
    const ok = await anmelden('Anna@Firma.DE', PW);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, rolle: 'mitglied', name: 'Anna' });
    const me = await m.session.benutzerAusToken(cookieVon(ok)!);
    expect(me).toMatchObject({ email: 'anna@firma.de', rolle: 'mitglied', envAdmin: false });
    expect(m.b.ladeBenutzerPerEmail('anna@firma.de')!.letzterLoginAt).toBeInstanceOf(Date);
    expect((await anmelden('anna@firma.de', 'falsch-falsch-falsch')).status).toBe(401);
    // Das Admin-Passwort öffnet keinen Benutzer-Login
    expect((await anmelden('anna@firma.de', 'test-admin-passwort')).status).toBe(401);
  });

  it('deaktivierter Benutzer kommt nicht rein – mit derselben Meldung wie bei falschem Passwort', async () => {
    const u = await legeBenutzerAn('deaktiviert@firma.de', 'mitglied');
    expect(m.b.setzeAktiv(u.id, false, 0).ok).toBe(true);
    const res = await anmelden('deaktiviert@firma.de', PW);
    const falsch = await anmelden('deaktiviert@firma.de', 'falsch-falsch-falsch');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(await falsch.json());
    expect(cookieVon(res)).toBeNull();
  });

  it('keine Benutzer-Enumeration: gleiche Antwort bei unbekannter E-Mail und ähnliche Laufzeit', async () => {
    await legeBenutzerAn('bekannt@firma.de', 'mitglied');
    const messe = async (email: string) => {
      const t0 = performance.now();
      const res = await anmelden(email, 'falsch-falsch-falsch');
      return { ms: performance.now() - t0, status: res.status, body: await res.json() };
    };
    const bekannt: Awaited<ReturnType<typeof messe>>[] = [];
    const unbekannt: Awaited<ReturnType<typeof messe>>[] = [];
    for (let i = 0; i < 3; i++) {
      bekannt.push(await messe('bekannt@firma.de'));
      unbekannt.push(await messe(`gibt-es-nicht-${i}@firma.de`));
    }
    for (const r of [...bekannt, ...unbekannt]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: 'E-Mail oder Passwort falsch' });
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[1];
    const mb = median(bekannt.map((r) => r.ms));
    const mu = median(unbekannt.map((r) => r.ms));
    // Der Dummy-Hash kostet dieselbe scrypt-Rechenzeit: unbekannt darf nicht deutlich schneller sein
    expect(mu).toBeGreaterThan(mb * 0.5);
    // Ungültiges E-Mail-Format verrät ebenfalls nichts
    const kaputt = await anmelden('kein-email-format', 'irgendwas');
    expect(kaputt.status).toBe(401);
  });

  it('Ratelimit je IP (5 Fehlversuche) und je E-Mail (10), auch für unbekannte Adressen', async () => {
    const ip = neueIp();
    for (let i = 0; i < 5; i++) expect((await anmelden(undefined, 'falsch', ip)).status).toBe(401);
    expect((await anmelden(undefined, 'test-admin-passwort', ip)).status).toBe(429);
    // andere IP ist unberührt
    expect((await anmelden(undefined, 'test-admin-passwort')).status).toBe(200);

    // je E-Mail: Versuche von wechselnden IPs
    await legeBenutzerAn('limit@firma.de', 'mitglied');
    for (let i = 0; i < 10; i++) expect((await anmelden('limit@firma.de', 'falsch-falsch-falsch')).status).toBe(401);
    expect((await anmelden('limit@firma.de', PW)).status).toBe(429);
    // unbekannte Adresse verhält sich genauso
    for (let i = 0; i < 10; i++) expect((await anmelden('niemand-limit@firma.de', 'falsch-falsch-falsch')).status).toBe(401);
    expect((await anmelden('niemand-limit@firma.de', PW)).status).toBe(429);
  });

  it('Benutzer-Login setzt den IP-Zähler nicht zurück', async () => {
    await legeBenutzerAn('zaehler@firma.de', 'mitglied');
    const ip = neueIp();
    for (let i = 0; i < 4; i++) await anmelden('niemand-zaehler@firma.de', 'falsch-falsch-falsch', ip);
    expect((await anmelden('zaehler@firma.de', PW, ip)).status).toBe(200);
    expect((await anmelden('niemand-zaehler@firma.de', 'falsch-falsch-falsch', ip)).status).toBe(401); // 5. Fehlversuch zählt weiter
    expect((await anmelden('zaehler@firma.de', PW, ip)).status).toBe(429);
  });
});

describe('Einladungen', () => {
  it('gültige Einladung: Benutzer wird angelegt, Einladung angenommen, Login erfolgt', async () => {
    const e = m.b.erstelleEinladungFuerNeuenBenutzer('Neu@Firma.de', 'lesen');
    if (!e.ok) throw new Error('x');
    expect(e.einladung.email).toBe('neu@firma.de');
    expect(e.einladung.tokenHash).toBe(m.b.hashToken(e.token));
    expect(e.einladung.tokenHash).not.toContain(e.token);
    expect(e.einladung.ablaufAt.getTime() - e.einladung.createdAt.getTime()).toBe(7 * 24 * 3600 * 1000);
    const res = await m.einl.POST(json(`/api/einladung/${e.token}`, 'POST', { name: 'Neue Person', passwort: PW }), ctx({ token: e.token }));
    expect(res.status).toBe(200);
    const me = await m.session.benutzerAusToken(cookieVon(res)!);
    expect(me).toMatchObject({ email: 'neu@firma.de', name: 'Neue Person', rolle: 'lesen' });
    const b = m.b.ladeBenutzerPerEmail('neu@firma.de')!;
    expect(b.passwortHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(b.passwortHash).not.toContain(PW);
    const row = m.db.getDb().select().from(m.db.schema.einladungen).where(eq(m.db.schema.einladungen.id, e.einladung.id)).get()!;
    expect(row.angenommenAt).toBeInstanceOf(Date);
  });

  it('doppelt benutzt: zweiter Versuch wird abgewiesen, es entsteht kein zweiter Benutzer', async () => {
    const e = m.b.erstelleEinladungFuerNeuenBenutzer('doppelt@firma.de', 'mitglied');
    if (!e.ok) throw new Error('x');
    const a = await m.einl.POST(json(`/api/einladung/${e.token}`, 'POST', { name: 'A', passwort: PW }), ctx({ token: e.token }));
    const b = await m.einl.POST(json(`/api/einladung/${e.token}`, 'POST', { name: 'B', passwort: 'anderes-passwort-123' }), ctx({ token: e.token }));
    expect(a.status).toBe(200);
    expect(b.status).toBe(410);
    expect((await b.json()).error).toMatch(/bereits verwendet/);
    expect(cookieVon(b)).toBeNull();
    expect(m.b.ladeBenutzerPerEmail('doppelt@firma.de')!.name).toBe('A');
    // gleichzeitig: genau einer gewinnt
    const e2 = m.b.erstelleEinladungFuerNeuenBenutzer('parallel@firma.de', 'mitglied');
    if (!e2.ok) throw new Error('x');
    const rs = await Promise.all([1, 2, 3].map((i) => m.einl.POST(json(`/api/einladung/${e2.token}`, 'POST', { name: `P${i}`, passwort: PW }), ctx({ token: e2.token }))));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(m.db.getDb().select().from(m.db.schema.benutzer).where(eq(m.db.schema.benutzer.email, 'parallel@firma.de')).all()).toHaveLength(1);
  });

  it('abgelaufen, unbekannt, widerrufen, kurzes Passwort', async () => {
    const e = m.b.erstelleEinladungFuerNeuenBenutzer('alt@firma.de', 'mitglied', new Date(Date.now() - 8 * 24 * 3600 * 1000));
    if (!e.ok) throw new Error('x');
    expect(m.b.pruefeEinladung(e.token).status).toBe('abgelaufen');
    const res = await m.einl.POST(json(`/api/einladung/${e.token}`, 'POST', { name: 'A', passwort: PW }), ctx({ token: e.token }));
    expect(res.status).toBe(410);
    expect((await res.json()).error).toMatch(/abgelaufen/);
    expect(m.b.ladeBenutzerPerEmail('alt@firma.de')).toBeUndefined();

    const unbekannt = 'x'.repeat(43);
    const r2 = await m.einl.POST(json(`/api/einladung/${unbekannt}`, 'POST', { name: 'A', passwort: PW }), ctx({ token: unbekannt }));
    expect(r2.status).toBe(404);

    const w = m.b.erstelleEinladungFuerNeuenBenutzer('widerruf@firma.de', 'mitglied');
    if (!w.ok) throw new Error('x');
    expect(m.b.widerrufeEinladung(w.einladung.id)).toBe(true);
    expect(m.b.pruefeEinladung(w.token).status).toBe('unbekannt');

    const k = m.b.erstelleEinladungFuerNeuenBenutzer('kurz@firma.de', 'mitglied');
    if (!k.ok) throw new Error('x');
    const r3 = await m.einl.POST(json(`/api/einladung/${k.token}`, 'POST', { name: 'A', passwort: 'zu-kurz' }), ctx({ token: k.token }));
    expect(r3.status).toBe(400);
    expect(m.b.pruefeEinladung(k.token).status).toBe('gueltig'); // nicht verbraucht
  });

  it('neue Einladung für dieselbe Adresse ersetzt die alte; Adresse mit Benutzer wird abgelehnt', async () => {
    const a = m.b.erstelleEinladungFuerNeuenBenutzer('zwei@firma.de', 'mitglied');
    const b = m.b.erstelleEinladungFuerNeuenBenutzer('zwei@firma.de', 'lesen');
    if (!a.ok || !b.ok) throw new Error('x');
    expect(m.b.pruefeEinladung(a.token).status).toBe('unbekannt');
    expect(m.b.pruefeEinladung(b.token).status).toBe('gueltig');
    await legeBenutzerAn('vorhanden@firma.de', 'mitglied');
    const r = m.b.erstelleEinladungFuerNeuenBenutzer('Vorhanden@firma.de', 'admin');
    expect(r.ok).toBe(false);
  });

  it('Passwort zurücksetzen = Link; neues Passwort gilt, altes nicht, alte Sessions sind entwertet', async () => {
    const u = await legeBenutzerAn('reset@firma.de', 'mitglied');
    const admin = await adminCookie();
    const res = await m.reset.POST(json(`/api/benutzer/${u.id}/passwort-zuruecksetzen`, 'POST', undefined, admin), ctx({ id: String(u.id) }));
    expect(res.status).toBe(201);
    const { link } = (await res.json()) as { link: string };
    expect(link).toMatch(/^https:\/\/video\.example\.de\/einladung\/[A-Za-z0-9_-]{43}$/);
    const token = link.split('/').pop()!;
    expect(m.b.pruefeEinladung(token)).toMatchObject({ status: 'gueltig', zuruecksetzen: true });
    const neu = await m.einl.POST(json(`/api/einladung/${token}`, 'POST', { name: '', passwort: 'ganz-neues-passwort-1' }), ctx({ token }));
    expect(neu.status).toBe(200);
    expect(await m.session.benutzerAusToken(u.cookie.cookie.split('=')[1])).toBeNull(); // alte Session
    expect(await m.session.benutzerAusToken(cookieVon(neu)!)).toMatchObject({ email: 'reset@firma.de', rolle: 'mitglied' });
    expect((await anmelden('reset@firma.de', PW)).status).toBe(401);
    expect((await anmelden('reset@firma.de', 'ganz-neues-passwort-1')).status).toBe(200);
    expect(m.b.listeBenutzer().filter((b) => b.email === 'reset@firma.de')).toHaveLength(1);
  });

  it('Einladung gilt nur für Admins zu erstellen/widerrufen', async () => {
    const mitglied = await legeBenutzerAn('mitglied-einl@firma.de', 'mitglied');
    const r = await m.benutzerEinl.POST(json('/api/benutzer/einladungen', 'POST', { email: 'x@firma.de', rolle: 'admin' }, mitglied.cookie));
    expect(r.status).toBe(403);
    const admin = await adminCookie();
    const ok = await m.benutzerEinl.POST(json('/api/benutzer/einladungen', 'POST', { email: 'Angelegt@firma.de', rolle: 'mitglied' }, admin));
    expect(ok.status).toBe(201);
    const d = (await ok.json()) as { id: number; link: string };
    expect(d.link.startsWith('https://video.example.de/einladung/')).toBe(true);
    const liste = (await (await m.benutzerListe.GET(json('/api/benutzer', 'GET', undefined, admin))).json()) as { einladungen: Record<string, unknown>[]; benutzer: Record<string, unknown>[] };
    expect(JSON.stringify(liste)).not.toContain('tokenHash');
    expect(JSON.stringify(liste)).not.toContain('passwortHash');
    const w = await m.benutzerEinlId.DELETE(json(`/api/benutzer/einladungen/${d.id}`, 'DELETE', undefined, mitglied.cookie), ctx({ id: String(d.id) }));
    expect(w.status).toBe(403);
    const w2 = await m.benutzerEinlId.DELETE(json(`/api/benutzer/einladungen/${d.id}`, 'DELETE', undefined, admin), ctx({ id: String(d.id) }));
    expect(w2.status).toBe(200);
  });
});

describe('Sessions werden sofort entwertet', () => {
  const ladeToken = (c: { cookie: string }) => c.cookie.slice('vo_session='.length);

  it('Deaktivieren', async () => {
    const u = await legeBenutzerAn('sess-deakt@firma.de', 'mitglied');
    expect(await m.session.benutzerAusToken(ladeToken(u.cookie))).not.toBeNull();
    const admin = await adminCookie();
    const r = await m.benutzerId.PATCH(json(`/api/benutzer/${u.id}`, 'PATCH', { aktiv: false }, admin), ctx({ id: String(u.id) }));
    expect(r.status).toBe(200);
    expect(await m.session.benutzerAusToken(ladeToken(u.cookie))).toBeNull();
    // API-Routen weisen das Cookie ab (401), obwohl Signatur und Ablauf stimmen
    const abfrage = await m.session.erfordereRolle(json('/api/campaigns', 'GET', undefined, u.cookie), 'lesen');
    expect(abfrage.ok).toBe(false);
    if (!abfrage.ok) expect(abfrage.response.status).toBe(401);
    // Wieder aktivieren stellt die alte Session NICHT wieder her
    await m.benutzerId.PATCH(json(`/api/benutzer/${u.id}`, 'PATCH', { aktiv: true }, admin), ctx({ id: String(u.id) }));
    expect(await m.session.benutzerAusToken(ladeToken(u.cookie))).toBeNull();
    expect((await anmelden('sess-deakt@firma.de', PW)).status).toBe(200);
  });

  it('Rollenwechsel: altes Token mit alter Rolle wird ungültig; Neulogin hat die neue Rolle', async () => {
    const u = await legeBenutzerAn('sess-rolle@firma.de', 'admin');
    const admin = await adminCookie();
    expect(await m.session.benutzerAusToken(ladeToken(u.cookie))).toMatchObject({ rolle: 'admin' });
    const r = await m.benutzerId.PATCH(json(`/api/benutzer/${u.id}`, 'PATCH', { rolle: 'lesen' }, admin), ctx({ id: String(u.id) }));
    expect(r.status).toBe(200);
    expect(await m.session.benutzerAusToken(ladeToken(u.cookie))).toBeNull();
    const neu = await anmelden('sess-rolle@firma.de', PW);
    expect(await m.session.benutzerAusToken(cookieVon(neu)!)).toMatchObject({ rolle: 'lesen' });
  });

  it('Löschen', async () => {
    const u = await legeBenutzerAn('sess-loeschen@firma.de', 'mitglied');
    const admin = await adminCookie();
    const r = await m.benutzerId.DELETE(json(`/api/benutzer/${u.id}`, 'DELETE', undefined, admin), ctx({ id: String(u.id) }));
    expect(r.status).toBe(200);
    expect(await m.session.benutzerAusToken(ladeToken(u.cookie))).toBeNull();
    expect((await anmelden('sess-loeschen@firma.de', PW)).status).toBe(401);
  });

  it('gefälschtes Token mit höherer Rolle (falsche Signatur) und Token mit Rolle ≠ DB-Rolle sind ungültig', async () => {
    const u = await legeBenutzerAn('sess-faelschung@firma.de', 'lesen');
    const teile = ladeToken(u.cookie).split('.');
    teile[2] = 'admin';
    expect(await m.session.benutzerAusToken(teile.join('.'))).toBeNull();
    // richtig signiert, aber Rolle weicht von der DB ab (z. B. Token aus früherem Zustand)
    const secret = process.env.SESSION_SECRET!;
    const t = await m.auth.createSessionToken(secret, Date.now(), { benutzerId: u.id, rolle: 'admin', version: m.b.ladeBenutzer(u.id)!.sessionVersion });
    expect(await m.session.benutzerAusToken(t)).toBeNull();
    // Token für nicht vorhandene Benutzer-Id
    const t2 = await m.auth.createSessionToken(secret, Date.now(), { benutzerId: 99999, rolle: 'admin', version: 0 });
    expect(await m.session.benutzerAusToken(t2)).toBeNull();
  });

  it('Header-Spoofing im Route-Handler: x-vo-rolle: admin vom Client bleibt wirkungslos', async () => {
    const u = await legeBenutzerAn('spoof@firma.de', 'lesen');
    const a = await m.session.erfordereRolle(json('/api/benutzer', 'GET', undefined, { ...u.cookie, 'x-vo-rolle': 'admin', 'x-vo-benutzer': '0' }), 'admin');
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.response.status).toBe(403);
    const ohne = await m.session.erfordereRolle(json('/api/benutzer', 'GET', undefined, { 'x-vo-rolle': 'admin', 'x-vo-benutzer': '0' }), 'lesen');
    expect(ohne.ok).toBe(false);
    if (!ohne.ok) expect(ohne.response.status).toBe(401);
  });
});

describe('Benutzerverwaltung', () => {
  it('Selbstschutz: sich nicht selbst deaktivieren/löschen; letzter Benutzer-Admin kann sich die Rolle nicht entziehen', async () => {
    // nur Benutzer-Admin = u (andere Admins aus anderen Tests deaktivieren)
    for (const b of m.b.listeBenutzer().filter((x) => x.rolle === 'admin')) m.b.setzeAktiv(b.id, false, 0);
    const u = await legeBenutzerAn('letzter-admin@firma.de', 'admin');
    expect(m.b.anzahlAktiveAdmins()).toBe(1);
    const r1 = m.b.aendereRolle(u.id, 'mitglied', u.id);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.fehler).toMatch(/letzte Admin/);
    expect(m.b.setzeAktiv(u.id, false, u.id).ok).toBe(false);
    expect(m.b.loescheBenutzer(u.id, u.id).ok).toBe(false);
    // Der Env-Admin (Id 0) darf einen letzten Benutzer-Admin ändern – der ADMIN_PASSWORD-Zugang bleibt als Fallback
    expect(m.b.aendereRolle(u.id, 'mitglied', 0).ok).toBe(true);
    // Mit einem zweiten Admin darf man sich selbst herabstufen
    const v = await legeBenutzerAn('zweiter-admin@firma.de', 'admin');
    m.b.aendereRolle(u.id, 'admin', 0);
    expect(m.b.aendereRolle(u.id, 'mitglied', u.id).ok).toBe(true);
    expect(v.id).toBeGreaterThan(0);
  });

  it('PATCH an sich selbst gibt ein neues Cookie mit neuer Version', async () => {
    const a = await legeBenutzerAn('selbst-a@firma.de', 'admin');
    const b = await legeBenutzerAn('selbst-b@firma.de', 'admin');
    const res = await m.benutzerId.PATCH(json(`/api/benutzer/${a.id}`, 'PATCH', { rolle: 'mitglied' }, a.cookie), ctx({ id: String(a.id) }));
    expect(res.status).toBe(200);
    const neu = cookieVon(res)!;
    expect(await m.session.benutzerAusToken(neu)).toMatchObject({ rolle: 'mitglied' });
    expect(b.id).not.toBe(a.id);
  });

  it('Nicht vorhandene Ziele → 404, ungültige Rolle → 400', async () => {
    const admin = await adminCookie();
    expect((await m.benutzerId.PATCH(json('/api/benutzer/99999', 'PATCH', { aktiv: false }, admin), ctx({ id: '99999' }))).status).toBe(404);
    expect((await m.benutzerId.DELETE(json('/api/benutzer/99999', 'DELETE', undefined, admin), ctx({ id: '99999' }))).status).toBe(404);
    const u = await legeBenutzerAn('rolle-ungueltig@firma.de', 'lesen');
    expect((await m.benutzerId.PATCH(json(`/api/benutzer/${u.id}`, 'PATCH', { rolle: 'root' }, admin), ctx({ id: String(u.id) }))).status).toBe(400);
  });
});

describe('Mein Konto', () => {
  it('Name ändern, Passwort nur mit altem Passwort; andere Sessions werden entwertet, die aktuelle bekommt ein neues Token', async () => {
    const u = await legeBenutzerAn('konto@firma.de', 'lesen', 'Alt Name'); // auch „lesen“ darf das eigene Konto ändern
    const zweite = await anmelden('konto@firma.de', PW);
    const zweiteToken = cookieVon(zweite)!;

    const n = await m.konto.PATCH(json('/api/konto', 'PATCH', { name: 'Neuer Name' }, u.cookie));
    expect(n.status).toBe(200);
    expect(m.b.ladeBenutzer(u.id)!.name).toBe('Neuer Name');

    const falsch = await m.konto.PATCH(json('/api/konto', 'PATCH', { altesPasswort: 'falsch-falsch-falsch', neuesPasswort: 'neues-passwort-1234' }, u.cookie));
    expect(falsch.status).toBe(403);
    const kurz = await m.konto.PATCH(json('/api/konto', 'PATCH', { altesPasswort: PW, neuesPasswort: 'kurz' }, u.cookie));
    expect(kurz.status).toBe(400);
    const ohneAlt = await m.konto.PATCH(json('/api/konto', 'PATCH', { neuesPasswort: 'neues-passwort-1234' }, u.cookie));
    expect(ohneAlt.status).toBe(403);

    const ok = await m.konto.PATCH(json('/api/konto', 'PATCH', { altesPasswort: PW, neuesPasswort: 'neues-passwort-1234' }, u.cookie));
    expect(ok.status).toBe(200);
    expect(await m.session.benutzerAusToken(zweiteToken)).toBeNull();
    expect(await m.session.benutzerAusToken(cookieVon(ok)!)).toMatchObject({ email: 'konto@firma.de' });
    expect((await anmelden('konto@firma.de', PW)).status).toBe(401);
    expect((await anmelden('konto@firma.de', 'neues-passwort-1234')).status).toBe(200);
  });

  it('Ratelimit für das bisherige Passwort; Env-Admin hat kein Konto; ohne Login 401', async () => {
    const u = await legeBenutzerAn('konto-limit@firma.de', 'mitglied');
    for (let i = 0; i < 5; i++) expect((await m.konto.PATCH(json('/api/konto', 'PATCH', { altesPasswort: 'falsch-falsch-falsch', neuesPasswort: 'neues-passwort-1234' }, u.cookie))).status).toBe(403);
    expect((await m.konto.PATCH(json('/api/konto', 'PATCH', { altesPasswort: PW, neuesPasswort: 'neues-passwort-1234' }, u.cookie))).status).toBe(429);
    expect((await m.konto.PATCH(json('/api/konto', 'PATCH', { name: 'X' }, await adminCookie()))).status).toBe(400);
    expect((await m.konto.PATCH(json('/api/konto', 'PATCH', { name: 'X' }))).status).toBe(401);
  });
});
