import { NextResponse } from 'next/server';
import { wiederholeJob } from '@/lib/leadgen/lauf';
import { fehler } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fehlgeschlagenen Pipeline-Job von Hand erneut einreihen. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültiger Job', 404);
  return wiederholeJob(id) ? NextResponse.json({ ok: true }) : fehler('Job nicht gefunden oder nicht fehlgeschlagen', 404);
}
