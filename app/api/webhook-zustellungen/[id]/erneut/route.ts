import { NextResponse } from 'next/server';
import { fehler } from '@/lib/request';
import { sendeErneut } from '@/lib/webhooks';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

/** Zustellung aus dem Protokoll erneut senden (legt eine neue offene Zustellung an). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || !sendeErneut(id)) return fehler('Zustellung nicht gefunden', 404);
  return NextResponse.json({ ok: true });
}
