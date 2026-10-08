import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { unsubscribeBySlug } from '@/lib/suppression';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Abmeldung per POST (One-Click nach RFC 8058 und Formular der Seite /abmelden/[slug]).
 * Öffentlich, idempotent, keine Cookies. Unbekannte Slugs werden neutral beantwortet.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (/^[a-z0-9-]{1,80}$/.test(slug)) unsubscribeBySlug(slug);

  // Formular der Abmelde-Seite → zurück zur Bestätigung; One-Click-Clients bekommen 200 Text
  let vonSeite = false;
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('application/x-www-form-urlencoded')) vonSeite = (await req.formData()).get('seite') === '1';
  } catch {
    // Body unlesbar – wie One-Click behandeln
  }
  if (vonSeite) {
    const base = getEnv().APP_URL.replace(/\/$/, '');
    return NextResponse.redirect(`${base}/abmelden/${encodeURIComponent(slug)}?ok=1`, 303);
  }
  return new NextResponse('Sie erhalten keine weiteren E-Mails.', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
