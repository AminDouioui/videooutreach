import { NextResponse } from 'next/server';
import { widerrufeEinladung } from '@/lib/benutzer';
import { fehler } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

/** Offene Einladung widerrufen (nur Admin). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || !widerrufeEinladung(id)) return fehler('Einladung nicht gefunden', 404);
  return NextResponse.json({ ok: true });
}
