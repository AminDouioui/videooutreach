import { NextResponse } from 'next/server';
import { listeBenutzer, listeEinladungen } from '@/lib/benutzer';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Benutzer und offene Einladungen (nur Admin; ohne Passwort-Hashes und Token). */
export async function GET(req: Request) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  return NextResponse.json({ benutzer: listeBenutzer(), einladungen: listeEinladungen() }, { headers: { 'Cache-Control': 'no-store' } });
}
