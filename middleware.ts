import { NextResponse, type NextRequest } from 'next/server';
import { HEADER_BENUTZER, HEADER_ROLLE, SESSION_COOKIE, isPublicPath, pruefeSessionToken } from '@/lib/auth';

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Die Header x-vo-rolle/x-vo-benutzer setzt ausschließlich diese Middleware. Vom Client mitgeschickte Werte werden
  // auf jedem Pfad (auch öffentlichen) entfernt bzw. überschrieben.
  const headers = new Headers(req.headers);
  headers.delete(HEADER_ROLLE);
  headers.delete(HEADER_BENUTZER);

  if (isPublicPath(pathname)) return NextResponse.next({ request: { headers } });

  const session = await pruefeSessionToken(req.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET ?? '');
  if (session) {
    headers.set(HEADER_ROLLE, session.rolle);
    headers.set(HEADER_BENUTZER, String(session.benutzerId));
    return NextResponse.next({ request: { headers } });
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
