import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE, SESSION_DAUER_MS, createSessionToken, passwordMatches } from '@/lib/auth';
import { hashIp } from '@/lib/crypto';
import { getEnv } from '@/lib/env';
import { RateLimiter } from '@/lib/ratelimit';
import { clientIp, fehler, parseJson } from '@/lib/request';

export const runtime = 'nodejs';

// 5 Fehlversuche pro 15 Minuten und IP-Hash
const g = globalThis as unknown as { __loginLimiter?: RateLimiter };
const limiter = (g.__loginLimiter ??= new RateLimiter(5, 15 * 60 * 1000));

export async function POST(req: NextRequest) {
  const env = getEnv();
  const key = hashIp(clientIp(req));
  if (limiter.isBlocked(key)) return fehler('Zu viele Fehlversuche. Bitte später erneut versuchen.', 429);

  const parsed = await parseJson(req, z.object({ password: z.string().max(500) }));
  if ('response' in parsed) return parsed.response;

  if (!(await passwordMatches(parsed.data.password, env.ADMIN_PASSWORD))) {
    limiter.hit(key);
    return fehler('Falsches Passwort', 401);
  }
  limiter.reset(key);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(env.SESSION_SECRET), {
    httpOnly: true,
    secure: env.APP_URL.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAUER_MS / 1000,
  });
  return res;
}
