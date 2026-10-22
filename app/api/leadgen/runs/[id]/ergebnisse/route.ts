import { NextResponse } from 'next/server';
import { ladeLaufErgebnisse } from '@/lib/leadgen/ergebnisse';
import { fehler } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zahl = (v: string | null): number | undefined => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : undefined);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'lesen');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültiger Lauf', 404);
  const q = new URL(req.url).searchParams;
  const r = ladeLaufErgebnisse(id, {
    mindestScore: zahl(q.get('mindestScore')),
    nurVerifizierteEmail: q.has('nurVerifiziert') ? q.get('nurVerifiziert') === '1' : undefined,
    limit: zahl(q.get('limit')) ?? 200,
    offset: zahl(q.get('offset')),
  });
  return r ? NextResponse.json(r) : fehler('Lauf nicht gefunden', 404);
}
