import { NextResponse } from 'next/server';
import { setzePasswortZurueck } from '@/lib/benutzer';
import { einladungsLink } from '@/lib/einladungs-link';
import { fehler } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

/** Passwort zurücksetzen = neuer Einladungslink für die bestehende Adresse (nur Admin). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return fehler('Benutzer nicht gefunden', 404);
  const e = setzePasswortZurueck(id);
  if (!e.ok) return fehler(e.fehler, e.status);
  return NextResponse.json({ id: e.einladung.id, email: e.einladung.email, ablaufAt: e.einladung.ablaufAt, link: einladungsLink(e.token) }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
