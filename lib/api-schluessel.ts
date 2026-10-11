import { createHash, randomBytes } from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, schema } from './db';
import { RateLimiter } from './ratelimit';

// API-Schlüssel der REST-API (/api/v1). Gespeichert wird nur der sha256-Hash (der Schlüssel hat 256 Bit Entropie, ein
// schneller Hash genügt); der Klartext wird nur einmal bei der Erstellung angezeigt.

export type ApiRecht = (typeof schema.API_RECHTE)[number];
export type ApiSchluessel = typeof schema.apiSchluessel.$inferSelect;

export const API_LIMIT_PRO_MINUTE = 120;
const limiter = new RateLimiter(API_LIMIT_PRO_MINUTE, 60_000);

export function hashSchluessel(schluessel: string): string {
  return createHash('sha256').update(schluessel).digest('hex');
}

/** Neuer Schlüssel im Format `vo_<zufall>` (Klartext, nur zur einmaligen Anzeige). */
export function erzeugeSchluessel(): string {
  return `vo_${randomBytes(32).toString('base64url')}`;
}

/** Legt einen Schlüssel an; `schluessel` ist der Klartext und danach nirgends mehr abrufbar. */
export function legeSchluesselAn(name: string, rechte: ApiRecht): { schluessel: string; eintrag: ApiSchluessel } {
  const schluessel = erzeugeSchluessel();
  const eintrag = getDb()
    .insert(schema.apiSchluessel)
    .values({ name, praefix: schluessel.slice(0, 8), hash: hashSchluessel(schluessel), rechte })
    .returning()
    .get();
  return { schluessel, eintrag };
}

export function listeSchluessel(): ApiSchluessel[] {
  return getDb().select().from(schema.apiSchluessel).orderBy(desc(schema.apiSchluessel.id)).all();
}

export function widerrufeSchluessel(id: number, jetzt: Date = new Date()): boolean {
  const db = getDb();
  const k = db.select().from(schema.apiSchluessel).where(eq(schema.apiSchluessel.id, id)).get();
  if (!k) return false;
  if (!k.widerrufenAt) db.update(schema.apiSchluessel).set({ widerrufenAt: jetzt }).where(eq(schema.apiSchluessel.id, id)).run();
  return true;
}

export function loescheSchluessel(id: number): boolean {
  return getDb().delete(schema.apiSchluessel).where(eq(schema.apiSchluessel.id, id)).run().changes > 0;
}

/** JSON-Fehlerantwort der API: {fehler} */
export function apiFehler(meldung: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ fehler: meldung }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/** Header `Authorization: Bearer <schluessel>` → Klartext-Schlüssel oder null */
export function bearerToken(req: Request): string | null {
  const m = (req.headers.get('authorization') ?? '').match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : null;
}

export type ApiAuth = { ok: true; schluessel: ApiSchluessel } | { ok: false; response: NextResponse };

/**
 * Gemeinsame Prüfung aller /api/v1-Routen: Bearer-Schlüssel vorhanden, bekannt, nicht widerrufen, Recht ausreichend
 * ('schreiben' schließt 'lesen' ein), Ratelimit je Schlüssel. Aktualisiert die letzte Nutzung.
 */
export function pruefeApiZugriff(req: Request, benoetigt: ApiRecht, jetzt: Date = new Date()): ApiAuth {
  const token = bearerToken(req);
  if (!token) return { ok: false, response: apiFehler('API-Schlüssel fehlt (Header „Authorization: Bearer <schluessel>“)', 401, { 'WWW-Authenticate': 'Bearer' }) };
  const db = getDb();
  const k = db.select().from(schema.apiSchluessel).where(eq(schema.apiSchluessel.hash, hashSchluessel(token))).get();
  if (!k) return { ok: false, response: apiFehler('API-Schlüssel ungültig', 401, { 'WWW-Authenticate': 'Bearer' }) };
  if (k.widerrufenAt) return { ok: false, response: apiFehler('API-Schlüssel wurde widerrufen', 401, { 'WWW-Authenticate': 'Bearer' }) };
  if (benoetigt === 'schreiben' && k.rechte !== 'schreiben') return { ok: false, response: apiFehler('Dieser API-Schlüssel hat nur Leserechte', 403) };
  if (!limiter.hit(`k${k.id}`, jetzt.getTime())) return { ok: false, response: apiFehler(`Zu viele Anfragen (höchstens ${API_LIMIT_PRO_MINUTE} pro Minute)`, 429, { 'Retry-After': '60' }) };
  db.update(schema.apiSchluessel).set({ letzteNutzungAt: jetzt }).where(eq(schema.apiSchluessel.id, k.id)).run();
  return { ok: true, schluessel: k };
}

/** Nur für Tests: Ratelimit zurücksetzen */
export function setzeApiLimitZurueck(): void {
  for (let i = 1; i < 1000; i++) limiter.reset(`k${i}`);
}
