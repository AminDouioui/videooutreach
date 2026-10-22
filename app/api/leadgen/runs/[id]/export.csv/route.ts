import { ergebnisCsv } from '@/lib/leadgen/csv';
import { ladeLaufErgebnisse } from '@/lib/leadgen/ergebnisse';
import { fehler } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** CSV-Export der Ergebnisse (gleiche Filter wie die Liste; `ids` = kommagetrennte Firmen-IDs der Auswahl). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'lesen');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültiger Lauf', 404);
  const q = new URL(req.url).searchParams;
  const ids = q.get('ids')?.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const mindest = Number(q.get('mindestScore'));
  const r = ladeLaufErgebnisse(id, {
    mindestScore: Number.isFinite(mindest) && q.get('mindestScore') ? mindest : undefined,
    nurVerifizierteEmail: q.has('nurVerifiziert') ? q.get('nurVerifiziert') === '1' : undefined,
    companyIds: ids?.length ? ids : undefined,
  });
  if (!r) return fehler('Lauf nicht gefunden', 404);
  return new Response(ergebnisCsv(r.zeilen), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="leads-lauf-${id}.csv"`, 'Cache-Control': 'no-store' },
  });
}
