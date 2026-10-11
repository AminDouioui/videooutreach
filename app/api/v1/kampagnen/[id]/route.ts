import { NextResponse } from 'next/server';
import { apiFehler, pruefeApiZugriff } from '@/lib/api-schluessel';
import { ladeKampagne } from '@/lib/api-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/kampagnen/{id} – eine Kampagne (Recht: lesen) */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = pruefeApiZugriff(req, 'lesen');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  const k = Number.isInteger(id) ? ladeKampagne(id) : null;
  if (!k) return apiFehler('Kampagne nicht gefunden', 404);
  return NextResponse.json({ kampagne: k }, { headers: { 'Cache-Control': 'no-store' } });
}
