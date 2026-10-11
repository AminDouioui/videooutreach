// Edge-kompatibel: nur Web Crypto, keine Node-Module
export const SESSION_COOKIE = 'vo_session';
export const SESSION_DAUER_MS = 14 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacHex(secret: string, daten: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(daten)));
}

/** Konstantzeit-Vergleich zweier Strings (beliebige Länge). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** Passwortvergleich über HMAC beider Werte, damit die Länge nicht durchsickert. */
export async function passwordMatches(eingabe: string, erwartet: string): Promise<boolean> {
  const [a, b] = await Promise.all([hmacHex('pw-vergleich', eingabe), hmacHex('pw-vergleich', erwartet)]);
  return timingSafeEqualStr(a, b);
}

export const ROLLEN = ['admin', 'mitglied', 'lesen'] as const;
export type Rolle = (typeof ROLLEN)[number];

/** Rang der Rollen: höher = mehr Rechte */
const RANG: Record<Rolle, number> = { lesen: 1, mitglied: 2, admin: 3 };

export function hatRolle(ist: Rolle, mindestens: Rolle): boolean {
  return RANG[ist] >= RANG[mindestens];
}

export function istRolle(wert: unknown): wert is Rolle {
  return typeof wert === 'string' && (ROLLEN as readonly string[]).includes(wert);
}

/** Inhalt der Session. benutzerId 0 = Zugang über ADMIN_PASSWORD (immer admin). */
export type SessionDaten = { benutzerId: number; rolle: Rolle; version: number };

/** Anfrage-Header, über die die Middleware die geprüfte Rolle weitergibt (eingehende Werte werden immer überschrieben). */
export const HEADER_ROLLE = 'x-vo-rolle';
export const HEADER_BENUTZER = 'x-vo-benutzer';

const ENV_ADMIN: SessionDaten = { benutzerId: 0, rolle: 'admin', version: 0 };

/** Erzeugt Token `${expiresMs}.${benutzerId|0}.${rolle}.${version}.${hmacHex}` (HMAC über alles davor). */
export async function createSessionToken(secret: string, jetzt = Date.now(), daten: SessionDaten = ENV_ADMIN): Promise<string> {
  const text = `${jetzt + SESSION_DAUER_MS}.${daten.benutzerId}.${daten.rolle}.${daten.version}`;
  return `${text}.${await hmacHex(secret, text)}`;
}

/**
 * Prüft Format, Signatur und Ablauf. Tokens im alten Format (`expires.hmac`) sind ungültig (Neulogin nötig).
 * Liefert die Session-Daten oder null. Ob Benutzer/Version/aktiv noch stimmen, prüft `aktuellerBenutzer()` (braucht die DB).
 */
export async function pruefeSessionToken(token: string | undefined, secret: string, jetzt = Date.now()): Promise<SessionDaten | null> {
  if (!token || !secret) return null;
  const teile = token.split('.');
  if (teile.length !== 5) return null;
  const [expires, id, rolle, version, sig] = teile;
  if (!/^\d{1,16}$/.test(expires) || !/^\d{1,12}$/.test(id) || !/^\d{1,12}$/.test(version) || !sig) return null;
  if (!istRolle(rolle)) return null;
  const benutzerId = Number(id);
  // Der Zugang über ADMIN_PASSWORD (Id 0) ist immer admin, jeder andere Benutzer hat eine Id > 0
  if (benutzerId === 0 && (rolle !== 'admin' || Number(version) !== 0)) return null;
  if (Number(expires) <= jetzt) return null;
  if (!timingSafeEqualStr(sig, await hmacHex(secret, `${expires}.${id}.${rolle}.${version}`))) return null;
  return { benutzerId, rolle, version: Number(version) };
}

export async function verifySessionToken(token: string | undefined, secret: string, jetzt = Date.now()): Promise<boolean> {
  return (await pruefeSessionToken(token, secret, jetzt)) !== null;
}

/** Öffentliche Pfade, die keine Session brauchen. */
const OEFFENTLICH = ['/login', '/api/auth/login', '/v/', '/abmelden/', '/media/', '/api/t', '/api/o/', '/api/c/', '/api/unsubscribe/', '/api/v1/', '/_next/', '/favicon.ico'];

export function isPublicPath(pfad: string): boolean {
  // Einladung annehmen: genau die Seite und ihre POST-Route, mit genau einem Token-Segment
  if (/^\/(api\/)?einladung\/[A-Za-z0-9_-]{16,128}$/.test(pfad)) return true;
  return OEFFENTLICH.some((p) => (p.endsWith('/') ? pfad.startsWith(p) : pfad === p || pfad.startsWith(p + '/')));
}
