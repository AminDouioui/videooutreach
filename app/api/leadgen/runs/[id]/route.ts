import { NextResponse } from 'next/server';
import { ladeLaufStatus } from '@/lib/leadgen/lauf';
import { fehler } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fortschritt je Stufe, fehlgeschlagene Jobs und Kosten eines Laufs (die Oberfläche pollt diese Route). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'lesen');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültiger Lauf', 404);
  const status = ladeLaufStatus(id);
  return status ? NextResponse.json(status) : fehler('Lauf nicht gefunden', 404);
}
