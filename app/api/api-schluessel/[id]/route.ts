import { NextResponse } from 'next/server';
import { widerrufeSchluessel } from '@/lib/api-schluessel';
import { fehler } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

/** API-Schlüssel widerrufen (bleibt in der Liste sichtbar, funktioniert aber nicht mehr). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || !widerrufeSchluessel(id)) return fehler('Schlüssel nicht gefunden', 404);
  return NextResponse.json({ ok: true });
}
