import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hashIp } from '@/lib/crypto';
import { nehmeEinladungAn, pruefeEinladung } from '@/lib/benutzer';
import { RateLimiter } from '@/lib/ratelimit';
import { clientIp, fehler, parseJson } from '@/lib/request';
import { setzeSessionCookie } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Öffentlich (der Token ist das Geheimnis): höchstens 10 ungültige Tokens bzw. Fehlversuche pro 15 Minuten und IP
const g = globalThis as unknown as { __einladungLimiter?: RateLimiter };
const limiter = (g.__einladungLimiter ??= new RateLimiter(10, 15 * 60 * 1000));

const bodySchema = z.object({ name: z.string().trim().max(120).default(''), passwort: z.string().max(500) });

/** Einladung annehmen: legt den Benutzer an (bzw. setzt das Passwort neu), markiert die Einladung und meldet an. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const key = hashIp(clientIp(req));
  if (limiter.isBlocked(key)) return fehler('Zu viele Versuche. Bitte später erneut versuchen.', 429);

  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  if (pruefeEinladung(token).status === 'unbekannt') limiter.hit(key);

  const ergebnis = await nehmeEinladungAn(token, parsed.data.name, parsed.data.passwort);
  if (!ergebnis.ok) return fehler(ergebnis.fehler, ergebnis.status);
  const b = ergebnis.benutzer;
  const res = NextResponse.json({ ok: true, name: b.name, rolle: b.rolle });
  await setzeSessionCookie(res, { benutzerId: b.id, rolle: b.rolle, version: b.sessionVersion });
  return res;
}
