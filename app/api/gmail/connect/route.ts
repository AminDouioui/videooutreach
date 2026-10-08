import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { buildAuthUrl, oauthConfigured } from '@/lib/gmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'vo_gmail_state';

/** Startet den OAuth-Ablauf: zufälliger state im httpOnly-Cookie, Weiterleitung zu Google. */
export async function GET() {
  const base = getEnv().APP_URL.replace(/\/$/, '');
  if (!oauthConfigured()) return NextResponse.redirect(`${base}/einstellungen?gmail=nicht_konfiguriert`);
  const state = randomBytes(24).toString('hex');
  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: base.startsWith('https://'),
    sameSite: 'lax',
    path: '/api/gmail',
    maxAge: 600,
  });
  return res;
}
