import { desc, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, schema } from '@/lib/db';
import { LaufFilterSchema, starteLauf } from '@/lib/leadgen/lauf';
import { pruefeVoraussetzungen } from '@/lib/leadgen/standard-deps';
import { parseJson } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await erfordereRolle(req, 'lesen');
  if (!auth.ok) return auth.response;
  const db = getDb();
  const laeufe = db.select().from(schema.pipelineRuns).orderBy(desc(schema.pipelineRuns.id)).limit(30).all();
  const firmen = new Map(db.select({ runId: schema.lauffirmen.runId, n: sql<number>`count(*)` }).from(schema.lauffirmen).groupBy(schema.lauffirmen.runId).all().map((x) => [x.runId, x.n]));
  return NextResponse.json(laeufe.map((r) => ({ id: r.id, status: r.status, filter: r.filter, gestartetAm: r.gestartetAm.getTime(), beendetAm: r.beendetAm?.getTime() ?? null, firmen: firmen.get(r.id) ?? 0 })));
}

/** Pipeline-Lauf starten: Filter prüfen, Lauf anlegen, erste Stufe einreihen (der Worker arbeitet den Rest ab). */
export async function POST(req: Request) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, z.object({ filter: LaufFilterSchema }));
  if ('response' in parsed) return parsed.response;
  const id = starteLauf(parsed.data.filter);
  return NextResponse.json({ id, voraussetzungen: pruefeVoraussetzungen() }, { status: 201 });
}
