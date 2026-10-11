import { NextResponse } from 'next/server';
import { widerrufeSchluessel } from '@/lib/api-schluessel';
import { fehler } from '@/lib/request';

export const runtime = 'nodejs';

/** API-Schlüssel widerrufen (bleibt in der Liste sichtbar, funktioniert aber nicht mehr). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || !widerrufeSchluessel(id)) return fehler('Schlüssel nicht gefunden', 404);
  return NextResponse.json({ ok: true });
}
