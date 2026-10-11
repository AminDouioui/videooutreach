import { NextResponse } from 'next/server';
import { fehler } from '@/lib/request';
import { sendeTest } from '@/lib/webhooks';

export const runtime = 'nodejs';

/** Test-Zustellung (Ereignis „test“) anlegen; der Worker stellt sie zu. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || !sendeTest(id)) return fehler('Webhook nicht gefunden', 404);
  return NextResponse.json({ ok: true });
}
