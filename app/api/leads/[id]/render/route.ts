import { NextResponse } from 'next/server';
import { fordereLeadRenderAn } from '@/lib/render-queue';
import { fehler } from '@/lib/request';

export const runtime = 'nodejs';

/** Einzelnes Video erzwungen neu rendern (auch wenn bereits fertig). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültiger Lead', 404);
  if (!fordereLeadRenderAn(id)) return fehler('Lead nicht gefunden oder wird gerade gerendert', 409);
  return NextResponse.json({ queued: 1 });
}
