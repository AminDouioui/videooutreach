import { NextResponse } from 'next/server';
import { ladeKampagnenStatus } from '@/lib/render-queue';
import { fehler } from '@/lib/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Render- und Versandfortschritt einer Kampagne (Polling durch die UI). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const status = ladeKampagnenStatus(id);
  if (!status) return fehler('Kampagne nicht gefunden', 404);
  return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
}
