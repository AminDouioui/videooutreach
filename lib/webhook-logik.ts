import { createHmac, randomBytes } from 'crypto';
import dns from 'dns';
import net from 'net';

// Reine Webhook-Logik (Signatur, Backoff, SSRF-Prüfung) ohne Datenbankzugriff

export { EREIGNIS_LABEL, TEST_EREIGNIS, WEBHOOK_EREIGNISSE } from './webhook-ereignisse';

/** Wartezeit bis zum nächsten Versuch (ms) nach dem n-ten fehlgeschlagenen Versuch: 1 min, 5 min, 30 min, 2 h, 12 h. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 12 * 3600_000] as const;

/** Wartezeit nach `versuche` bisherigen (fehlgeschlagenen) Versuchen; null = aufgeben (Status 'fehler'). */
export function backoffMs(versuche: number): number | null {
  if (versuche < 1) return BACKOFF_MS[0];
  return BACKOFF_MS[versuche - 1] ?? null;
}

export const ZEITLIMIT_MS = 10_000;
export const PROTOKOLL_ANZAHL = 100;
export const AUFBEWAHRUNG_TAGE = 30;

/** Neues Webhook-Geheimnis (zufällig, 256 Bit). */
export function neuesGeheimnis(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

/** Wert des Headers X-Signatur: `sha256=<HMAC-SHA256(geheimnis, body) als Hex>` */
export function signiere(geheimnis: string, body: string): string {
  return `sha256=${createHmac('sha256', geheimnis).update(body).digest('hex')}`;
}

// ---------------------------------------------------------------- SSRF-Schutz

function ipv4Zahlen(ip: string): number[] | null {
  const t = ip.split('.').map(Number);
  return t.length === 4 && t.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? t : null;
}

/** true für Adressen, die nicht öffentlich erreichbar sein sollen (Loopback, privat, link-local, CGNAT, Multicast …). */
export function istPrivateIp(ip: string): boolean {
  let a = ip.trim().toLowerCase();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  a = a.split('%')[0];
  const v4 = ipv4Zahlen(a);
  if (v4) {
    const [x, y, z] = v4;
    return (
      x === 0 ||
      x === 10 ||
      x === 127 ||
      (x === 100 && y >= 64 && y <= 127) ||
      (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 0 && z === 0) ||
      (x === 192 && y === 168) ||
      (x === 198 && (y === 18 || y === 19)) ||
      x >= 224
    );
  }
  if (net.isIPv6(a)) {
    // IPv4-gemappt (::ffff:a.b.c.d bzw. ::ffff:7f00:1)
    const gemappt = a.match(/^(?:0{0,4}:){0,5}ffff:(.+)$/);
    if (gemappt) {
      const rest = gemappt[1];
      if (ipv4Zahlen(rest)) return istPrivateIp(rest);
      const h = rest.split(':').map((p) => parseInt(p, 16));
      if (h.length === 2 && h.every((n) => Number.isInteger(n))) return istPrivateIp(`${h[0] >> 8}.${h[0] & 255}.${h[1] >> 8}.${h[1] & 255}`);
      return true;
    }
    const erste = parseInt(a.split(':')[0] || '0', 16);
    if (a === '::' || a === '::1') return true;
    if ((erste & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((erste & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((erste & 0xff00) === 0xff00) return true; // Multicast
    return false;
  }
  return true; // unbekanntes Format: lieber ablehnen
}

export type HostResolver = (host: string) => Promise<string[]>;

const standardResolver: HostResolver = async (host) => (await dns.promises.lookup(host, { all: true })).map((r) => r.address);

/** Sind private Ziele erlaubt (Tests, Intranet)? Env `WEBHOOK_PRIVATE_ERLAUBT=1`. */
export function privateZieleErlaubt(): boolean {
  return process.env.WEBHOOK_PRIVATE_ERLAUBT === '1';
}

export type ZielPruefung = { ok: true } | { ok: false; grund: string };

/**
 * Prüft ein Webhook-Ziel: nur http(s), keine Zugangsdaten in der URL, kein Ziel auf localhost/private/link-local
 * Adressen (auch nicht nach DNS-Auflösung). Der Resolver ist für Tests austauschbar.
 */
export async function pruefeWebhookZiel(
  url: string,
  opt: { resolver?: HostResolver; privatErlaubt?: boolean } = {},
): Promise<ZielPruefung> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, grund: 'Ungültige URL' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, grund: 'Nur http:// und https:// sind erlaubt' };
  if (u.username || u.password) return { ok: false, grund: 'Zugangsdaten in der URL sind nicht erlaubt' };
  if (opt.privatErlaubt ?? privateZieleErlaubt()) return { ok: true };

  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, grund: 'Ziele im lokalen Netz sind nicht erlaubt' };
  }
  const privat = { ok: false as const, grund: 'Ziele im lokalen oder privaten Netz sind nicht erlaubt' };
  if (net.isIP(host)) return istPrivateIp(host) ? privat : { ok: true };
  // Dezimal-/Hex-Schreibweisen von IPv4 normalisiert WHATWG-URL bereits zu a.b.c.d; Rest per DNS prüfen
  let adressen: string[];
  try {
    adressen = await (opt.resolver ?? standardResolver)(host);
  } catch {
    return { ok: false, grund: 'Host nicht auflösbar' };
  }
  if (adressen.length === 0) return { ok: false, grund: 'Host nicht auflösbar' };
  if (adressen.some(istPrivateIp)) return privat;
  return { ok: true };
}
