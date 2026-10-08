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

/** Erzeugt Token `${expiresMs}.${hmacHex}` */
export async function createSessionToken(secret: string, jetzt = Date.now()): Promise<string> {
  const expires = String(jetzt + SESSION_DAUER_MS);
  return `${expires}.${await hmacHex(secret, expires)}`;
}

export async function verifySessionToken(token: string | undefined, secret: string, jetzt = Date.now()): Promise<boolean> {
  if (!token || !secret) return false;
  const [expires, sig] = token.split('.');
  if (!expires || !sig || !/^\d+$/.test(expires)) return false;
  if (Number(expires) <= jetzt) return false;
  return timingSafeEqualStr(sig, await hmacHex(secret, expires));
}

/** Öffentliche Pfade, die keine Session brauchen. */
const OEFFENTLICH = ['/login', '/api/auth/login', '/v/', '/abmelden/', '/media/', '/api/t', '/api/o/', '/api/unsubscribe/', '/_next/', '/favicon.ico'];

export function isPublicPath(pfad: string): boolean {
  return OEFFENTLICH.some((p) => (p.endsWith('/') ? pfad.startsWith(p) : pfad === p || pfad.startsWith(p + '/')));
}
