import { timingSafeEqual } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { handleCallbackCode } from '@/lib/gmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'vo_gmail_state';

function gleich(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** OAuth-Rückkehr: state prüfen, Code tauschen, Adresse aus dem ID-Token lesen, Postfach speichern, zurück zu den Einstellungen. */
export async function GET(req: NextRequest) {
  const base = getEnv().APP_URL.replace(/\/$/, '');
  const ziel = (status: string, detail?: string) => {
    const url = new URL(`${base}/einstellungen`);
    url.searchParams.set('gmail', status);
    if (detail) url.searchParams.set('detail', detail.slice(0, 200));
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: STATE_COOKIE, path: '/api/gmail' });
    return res;
  };

  const sp = req.nextUrl.searchParams;
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;
  const state = sp.get('state');
  if (!cookieState || !state || !gleich(cookieState, state)) return ziel('fehler', 'Ungültiger state – bitte erneut verbinden');
  if (sp.get('error')) return ziel('fehler', sp.get('error') ?? '');
  const code = sp.get('code');
  if (!code) return ziel('fehler', 'Kein Code erhalten');
  try {
    const { email } = await handleCallbackCode(code);
    return ziel('verbunden', email);
  } catch (e) {
    return ziel('fehler', e instanceof Error ? e.message : 'Unbekannter Fehler');
  }
}
