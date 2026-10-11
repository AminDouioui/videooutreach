import { randomBytes } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { kannThreadLesen, ladeAbsender, ladeAbsenderMitId } from '@/lib/absender';
import { getEnv } from '@/lib/env';
import { buildAuthUrl, oauthConfigured } from '@/lib/gmail';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'vo_gmail_state';

/**
 * Startet den OAuth-Ablauf („Postfach hinzufügen“ bzw. mit ?absender=ID „Neu verbinden“, mit &lesezugriff=1 „Lesezugriff erteilen“): zufälliger state im
 * httpOnly-Cookie, Weiterleitung zu Google. login_hint: beim Neu-Verbinden die Adresse des Postfachs, beim Hinzufügen
 * nur dann SENDER_EMAIL, wenn es noch kein Postfach gibt (sonst würde das erste Konto vorgeschlagen).
 */
export async function GET(req: NextRequest) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const base = getEnv().APP_URL.replace(/\/$/, '');
  if (!oauthConfigured()) return NextResponse.redirect(`${base}/einstellungen?gmail=nicht_konfiguriert`);
  const absenderId = Number(req.nextUrl.searchParams.get('absender'));
  const erneut = Number.isInteger(absenderId) && absenderId > 0 ? ladeAbsenderMitId(absenderId) : null;
  const hint = erneut ? erneut.email : ladeAbsender().length === 0 ? getEnv().SENDER_EMAIL : undefined;
  // Lesezugriff (gmail.readonly) nur auf Wunsch (?lesezugriff=1) oder wenn das Postfach ihn schon hat (sonst ginge er beim Neu-Verbinden verloren)
  const lesezugriff = !!erneut && (req.nextUrl.searchParams.get('lesezugriff') === '1' || kannThreadLesen(erneut));
  const state = randomBytes(24).toString('hex');
  const res = NextResponse.redirect(buildAuthUrl(state, hint, lesezugriff));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: base.startsWith('https://'),
    sameSite: 'lax',
    path: '/api/gmail',
    maxAge: 600,
  });
  return res;
}
