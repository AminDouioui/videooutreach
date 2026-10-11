import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Passwort-Hashing mit scrypt (node:crypto). Gespeichert wird `salz:hash` (beides hex). Die Parameter sind fest
// (N = 2^15, r = 8, p = 1); eine spätere Erhöhung braucht ein Format-Feld, bevor bestehende Hashes ungültig würden.
const N = 2 ** 15;
const R = 8;
const P = 1;
const SCHLUESSEL_LAENGE = 64;
const SALZ_LAENGE = 16;
// scrypt braucht 128 * N * r Byte (32 MiB); node begrenzt standardmäßig genau darauf, daher großzügig
const OPTIONEN: ScryptOptions = { N, r: R, p: P, maxmem: 128 * N * R * 2 };

export const MIN_PASSWORT_LAENGE = 12;
export const MAX_PASSWORT_LAENGE = 200;

function ableiten(passwort: string, salz: Buffer, laenge = SCHLUESSEL_LAENGE): Promise<Buffer> {
  return new Promise((ok, fehler) => scrypt(passwort.normalize('NFKC'), salz, laenge, OPTIONEN, (e, key) => (e ? fehler(e) : ok(key))));
}

export async function hashePasswort(passwort: string): Promise<string> {
  const salz = randomBytes(SALZ_LAENGE);
  return `${salz.toString('hex')}:${(await ableiten(passwort, salz)).toString('hex')}`;
}

/** Konstantzeit-Vergleich; ein kaputter gespeicherter Wert gilt als „falsch“ (kostet aber dieselbe Rechenzeit). */
export async function pruefePasswort(passwort: string, gespeichert: string): Promise<boolean> {
  const [salzHex, hashHex, rest] = gespeichert.split(':');
  const gueltig = !rest && /^[0-9a-f]{32}$/.test(salzHex ?? '') && /^[0-9a-f]{128}$/.test(hashHex ?? '');
  const salz = gueltig ? Buffer.from(salzHex, 'hex') : Buffer.alloc(SALZ_LAENGE);
  const erwartet = gueltig ? Buffer.from(hashHex, 'hex') : Buffer.alloc(SCHLUESSEL_LAENGE);
  const ist = await ableiten(passwort, salz);
  return timingSafeEqual(ist, erwartet) && gueltig;
}

let dummy: Promise<string> | null = null;

/**
 * Prüft gegen einen Dummy-Hash (für unbekannte oder deaktivierte Benutzer), damit die Antwortzeit nicht verrät, ob die
 * E-Mail existiert. Der Dummy-Hash entsteht einmal zufällig im Prozess; das Ergebnis ist immer false.
 */
export async function pruefeDummyPasswort(passwort: string): Promise<false> {
  dummy ??= hashePasswort(randomBytes(24).toString('hex'));
  await pruefePasswort(passwort, await dummy);
  return false;
}

/** Fehlertext zur Passwortrichtlinie oder null */
export function passwortProblem(passwort: string): string | null {
  if (passwort.length < MIN_PASSWORT_LAENGE) return `Das Passwort muss mindestens ${MIN_PASSWORT_LAENGE} Zeichen lang sein.`;
  if (passwort.length > MAX_PASSWORT_LAENGE) return `Das Passwort darf höchstens ${MAX_PASSWORT_LAENGE} Zeichen lang sein.`;
  return null;
}
