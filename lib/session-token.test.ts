import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE, SESSION_DAUER_MS, createSessionToken, hatRolle, isPublicPath, pruefeSessionToken, verifySessionToken } from './auth';

const secret = 's'.repeat(32);
const jetzt = 1_800_000_000_000;

async function neu(daten: { benutzerId: number; rolle: 'admin' | 'mitglied' | 'lesen'; version: number } = { benutzerId: 7, rolle: 'mitglied', version: 3 }) {
  return createSessionToken(secret, jetzt, daten);
}

describe('Session-Token mit Benutzer, Rolle und Version', () => {
  it('Format expires.benutzerId.rolle.version.hmac', async () => {
    const t = await neu();
    const teile = t.split('.');
    expect(teile).toHaveLength(5);
    expect(teile.slice(0, 4)).toEqual([String(jetzt + SESSION_DAUER_MS), '7', 'mitglied', '3']);
    expect(teile[4]).toMatch(/^[0-9a-f]{64}$/);
    expect(await pruefeSessionToken(t, secret, jetzt)).toEqual({ benutzerId: 7, rolle: 'mitglied', version: 3 });
  });
  it('Standard (Admin-Zugang über ADMIN_PASSWORD): benutzerId 0, admin, Version 0', async () => {
    const t = await createSessionToken(secret, jetzt);
    expect(t.split('.').slice(1, 4)).toEqual(['0', 'admin', '0']);
    expect(await pruefeSessionToken(t, secret, jetzt)).toEqual({ benutzerId: 0, rolle: 'admin', version: 0 });
    expect(await verifySessionToken(t, secret, jetzt)).toBe(true);
  });
  it('Manipulation jedes Felds macht das Token ungültig', async () => {
    const teile = (await neu()).split('.');
    const aendern = (i: number, wert: string) => teile.map((t, j) => (j === i ? wert : t)).join('.');
    expect(await pruefeSessionToken(aendern(1, '1'), secret, jetzt)).toBeNull(); // andere Benutzer-Id
    expect(await pruefeSessionToken(aendern(2, 'admin'), secret, jetzt)).toBeNull(); // Rolle hochgestuft
    expect(await pruefeSessionToken(aendern(3, '4'), secret, jetzt)).toBeNull(); // andere Version
    expect(await pruefeSessionToken(aendern(0, String(jetzt + 10 * SESSION_DAUER_MS)), secret, jetzt)).toBeNull(); // verlängert
    expect(await pruefeSessionToken(aendern(4, '0'.repeat(64)), secret, jetzt)).toBeNull();
    expect(await pruefeSessionToken(aendern(4, ''), secret, jetzt)).toBeNull();
  });
  it('falsches Secret, Fremdformate, leere Werte', async () => {
    const t = await neu();
    expect(await pruefeSessionToken(t, 'x'.repeat(32), jetzt)).toBeNull();
    expect(await pruefeSessionToken(t, '', jetzt)).toBeNull();
    expect(await pruefeSessionToken(undefined, secret, jetzt)).toBeNull();
    expect(await pruefeSessionToken('', secret, jetzt)).toBeNull();
    expect(await pruefeSessionToken(`${t}.extra`, secret, jetzt)).toBeNull();
    expect(await pruefeSessionToken(`a.b.c.d.e`, secret, jetzt)).toBeNull();
  });
  it('abgelaufen', async () => {
    const t = await neu();
    expect(await pruefeSessionToken(t, secret, jetzt + SESSION_DAUER_MS - 1)).not.toBeNull();
    expect(await pruefeSessionToken(t, secret, jetzt + SESSION_DAUER_MS)).toBeNull();
    expect(await pruefeSessionToken(t, secret, jetzt + SESSION_DAUER_MS + 1)).toBeNull();
  });
  it('altes Format (expires.hmac) ist ungültig – Neulogin nötig', async () => {
    const expires = String(jetzt + SESSION_DAUER_MS);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(expires))))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(await pruefeSessionToken(`${expires}.${sig}`, secret, jetzt)).toBeNull();
    expect(await verifySessionToken(`${expires}.${sig}`, secret, jetzt)).toBe(false);
  });
  it('Id 0 ist nur als Admin mit Version 0 gültig, auch bei richtiger Signatur', async () => {
    expect(await pruefeSessionToken(await neu({ benutzerId: 0, rolle: 'mitglied', version: 0 }), secret, jetzt)).toBeNull();
    expect(await pruefeSessionToken(await neu({ benutzerId: 0, rolle: 'lesen', version: 0 }), secret, jetzt)).toBeNull();
    expect(await pruefeSessionToken(await neu({ benutzerId: 0, rolle: 'admin', version: 5 }), secret, jetzt)).toBeNull();
  });
  it('unbekannte Rolle trotz richtiger Signatur ist ungültig', async () => {
    const t = await neu({ benutzerId: 7, rolle: 'superadmin' as never, version: 3 });
    expect(await pruefeSessionToken(t, secret, jetzt)).toBeNull();
  });
});

describe('Rollenrang und öffentliche Pfade', () => {
  it('hatRolle', () => {
    expect(hatRolle('admin', 'admin')).toBe(true);
    expect(hatRolle('admin', 'mitglied')).toBe(true);
    expect(hatRolle('mitglied', 'admin')).toBe(false);
    expect(hatRolle('mitglied', 'lesen')).toBe(true);
    expect(hatRolle('lesen', 'mitglied')).toBe(false);
    expect(hatRolle('lesen', 'lesen')).toBe(true);
  });
  it('/einladung/<token> und /api/einladung/<token> sind öffentlich – sonst nichts darunter', () => {
    const t = 'A'.repeat(43);
    expect(isPublicPath(`/einladung/${t}`)).toBe(true);
    expect(isPublicPath(`/api/einladung/${t}`)).toBe(true);
    expect(isPublicPath('/einladung')).toBe(false);
    expect(isPublicPath('/einladung/')).toBe(false);
    expect(isPublicPath(`/einladung/${t}/x`)).toBe(false);
    expect(isPublicPath(`/api/einladung/${t}/x`)).toBe(false);
    expect(isPublicPath('/einladung/kurz')).toBe(false);
    expect(isPublicPath('/api/benutzer')).toBe(false);
    expect(isPublicPath('/api/benutzer/einladungen')).toBe(false);
    expect(isPublicPath('/einstellungen/benutzer')).toBe(false);
    expect(isPublicPath('/konto')).toBe(false);
    expect(isPublicPath('/api/konto')).toBe(false);
  });
});

describe('Middleware: Header-Spoofing', () => {
  process.env.SESSION_SECRET = secret;
  const anfrage = (pfad: string, headers: Record<string, string>) => new NextRequest(`https://video.example.de${pfad}`, { headers });
  const weitergegeben = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

  it('überschreibt vom Client geschickte x-vo-*-Header mit den geprüften Werten', async () => {
    const { middleware } = await import('../middleware');
    const token = await createSessionToken(secret, Date.now(), { benutzerId: 4, rolle: 'lesen', version: 1 });
    const res = await middleware(anfrage('/api/campaigns', { cookie: `${SESSION_COOKIE}=${token}`, 'x-vo-rolle': 'admin', 'x-vo-benutzer': '0' }));
    expect(weitergegeben(res, 'x-vo-rolle')).toBe('lesen');
    expect(weitergegeben(res, 'x-vo-benutzer')).toBe('4');
  });
  it('entfernt gefälschte Header, wenn keine Session vorliegt (401) und auf öffentlichen Pfaden', async () => {
    const { middleware } = await import('../middleware');
    const ohne = await middleware(anfrage('/api/campaigns', { 'x-vo-rolle': 'admin', 'x-vo-benutzer': '0' }));
    expect(ohne.status).toBe(401);
    expect(weitergegeben(ohne, 'x-vo-rolle')).toBeNull();
    const oeffentlich = await middleware(anfrage('/login', { 'x-vo-rolle': 'admin', 'x-vo-benutzer': '0' }));
    expect(oeffentlich.status).toBe(200);
    expect(weitergegeben(oeffentlich, 'x-vo-rolle')).toBeNull();
    expect(weitergegeben(oeffentlich, 'x-vo-benutzer')).toBeNull();
    // Das Overrides-Verzeichnis enthält die Header nicht (sie werden aus der Anfrage entfernt)
    expect(oeffentlich.headers.get('x-middleware-override-headers') ?? '').not.toContain('x-vo-rolle');
  });
  it('altes Token (Format expires.hmac) wird umgeleitet bzw. mit 401 abgewiesen', async () => {
    const { middleware } = await import('../middleware');
    const alt = `${Date.now() + 1000000}.${'a'.repeat(64)}`;
    const api = await middleware(anfrage('/api/campaigns', { cookie: `${SESSION_COOKIE}=${alt}` }));
    expect(api.status).toBe(401);
    const seite = await middleware(anfrage('/', { cookie: `${SESSION_COOKIE}=${alt}` }));
    expect(seite.status).toBe(307);
    expect(seite.headers.get('location')).toContain('/login');
  });
});
