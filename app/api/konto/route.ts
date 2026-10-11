import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aendereKonto } from '@/lib/benutzer';
import { RateLimiter } from '@/lib/ratelimit';
import { fehler, parseJson } from '@/lib/request';
import { erfordereRolle, setzeSessionCookie } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Das bisherige Passwort darf nicht beliebig oft geraten werden (z. B. mit einem gestohlenen Cookie): 5 Fehlversuche je 15 Minuten
const g = globalThis as unknown as { __kontoLimiter?: RateLimiter };
const limiter = (g.__kontoLimiter ??= new RateLimiter(5, 15 * 60 * 1000));

const bodySchema = z
  .object({ name: z.string().max(200), altesPasswort: z.string().max(500), neuesPasswort: z.string().max(500) })
  .partial();

/** Eigenes Konto (jede Rolle, auch „lesen“). Der ADMIN_PASSWORD-Zugang hat kein Konto zum Ändern. */
export async function PATCH(req: Request) {
  const auth = await erfordereRolle(req, 'lesen');
  if (!auth.ok) return auth.response;
  if (auth.benutzer.envAdmin) return fehler('Der Admin-Zugang über ADMIN_PASSWORD hat kein Konto. Das Passwort steht in der Server-Konfiguration.', 400);
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const key = `k${auth.benutzer.id}`;
  if (parsed.data.neuesPasswort !== undefined && limiter.isBlocked(key)) return fehler('Zu viele Fehlversuche. Bitte später erneut versuchen.', 429);
  const r = await aendereKonto(auth.benutzer.id, parsed.data);
  if (!r.ok) {
    if (r.status === 403) limiter.hit(key);
    return fehler(r.fehler, r.status);
  }
  limiter.reset(key);
  const res = NextResponse.json({ ok: true, name: r.benutzer.name });
  await setzeSessionCookie(res, { benutzerId: r.benutzer.id, rolle: r.benutzer.rolle, version: r.benutzer.sessionVersion });
  return res;
}
