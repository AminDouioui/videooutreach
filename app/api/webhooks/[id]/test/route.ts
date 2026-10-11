import { NextResponse } from 'next/server';
import { fehler } from '@/lib/request';
import { sendeTest } from '@/lib/webhooks';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

/** Test-Zustellung (Ereignis „test“) anlegen; der Worker stellt sie zu. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || !sendeTest(id)) return fehler('Webhook nicht gefunden', 404);
  return NextResponse.json({ ok: true });
}
