import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { passwordMatches } from '@/lib/auth';
import { ladeBenutzerPerEmail, normalisiereEmail, vermerkeLogin } from '@/lib/benutzer';
import { hashIp } from '@/lib/crypto';
import { getEnv } from '@/lib/env';
import { pruefeDummyPasswort, pruefePasswort } from '@/lib/passwort';
import { RateLimiter } from '@/lib/ratelimit';
import { clientIp, fehler, parseJson } from '@/lib/request';
import { setzeSessionCookie } from '@/lib/session';

export const runtime = 'nodejs';

// 5 Fehlversuche pro 15 Minuten und IP-Hash; zusätzlich 10 je E-Mail-Adresse (auch für unbekannte Adressen, damit
// das Limit nichts über vorhandene Konten verrät)
const g = globalThis as unknown as { __loginLimiter?: RateLimiter; __loginEmailLimiter?: RateLimiter };
const limiter = (g.__loginLimiter ??= new RateLimiter(5, 15 * 60 * 1000));
const emailLimiter = (g.__loginEmailLimiter ??= new RateLimiter(10, 15 * 60 * 1000));

const FALSCH = 'E-Mail oder Passwort falsch';
const ZU_VIELE = 'Zu viele Fehlversuche. Bitte später erneut versuchen.';

/**
 * Login. Ohne E-Mail: bisheriger Admin-Zugang über ADMIN_PASSWORD (benutzerId 0, Rolle admin). Mit E-Mail: Benutzer-Login.
 * Bei unbekannter oder deaktivierter Adresse wird trotzdem ein (Dummy-)Hash geprüft und dieselbe Meldung geliefert.
 */
export async function POST(req: NextRequest) {
  const env = getEnv();
  const ipKey = hashIp(clientIp(req));
  if (limiter.isBlocked(ipKey)) return fehler(ZU_VIELE, 429);

  const parsed = await parseJson(req, z.object({ email: z.string().max(320).optional().nullable(), password: z.string().max(500) }));
  if ('response' in parsed) return parsed.response;
  const email = normalisiereEmail(parsed.data.email ?? '');

  if (email === '') {
    if (!(await passwordMatches(parsed.data.password, env.ADMIN_PASSWORD))) {
      limiter.hit(ipKey);
      return fehler('Falsches Passwort', 401);
    }
    limiter.reset(ipKey);
    const res = NextResponse.json({ ok: true, rolle: 'admin', name: 'Admin' });
    await setzeSessionCookie(res, { benutzerId: 0, rolle: 'admin', version: 0 });
    return res;
  }

  const emailKey = createHash('sha256').update(email).digest('hex');
  if (emailLimiter.isBlocked(emailKey)) return fehler(ZU_VIELE, 429);

  const benutzer = ladeBenutzerPerEmail(email);
  const stimmt = benutzer ? await pruefePasswort(parsed.data.password, benutzer.passwortHash) : await pruefeDummyPasswort(parsed.data.password);
  if (!benutzer || !stimmt || !benutzer.aktiv) {
    limiter.hit(ipKey);
    emailLimiter.hit(emailKey);
    return fehler(FALSCH, 401);
  }
  // Die IP-Zähler werden bei Benutzer-Logins nicht zurückgesetzt (sonst könnte ein eigenes Konto sie leeren)
  emailLimiter.reset(emailKey);
  vermerkeLogin(benutzer.id);
  const res = NextResponse.json({ ok: true, rolle: benutzer.rolle, name: benutzer.name });
  await setzeSessionCookie(res, { benutzerId: benutzer.id, rolle: benutzer.rolle, version: benutzer.sessionVersion });
  return res;
}
