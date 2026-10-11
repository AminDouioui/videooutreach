import { NextResponse } from 'next/server';
import { pruefeApiZugriff } from '@/lib/api-schluessel';
import { ladeKampagnen } from '@/lib/api-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/kampagnen – alle Kampagnen (Recht: lesen) */
export async function GET(req: Request) {
  const auth = pruefeApiZugriff(req, 'lesen');
  if (!auth.ok) return auth.response;
  return NextResponse.json({ kampagnen: ladeKampagnen() }, { headers: { 'Cache-Control': 'no-store' } });
}
