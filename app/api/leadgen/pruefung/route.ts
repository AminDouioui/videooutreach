import { NextResponse } from 'next/server';
import { z } from 'zod';
import { entscheidePruefFall, ladePruefFaelle } from '@/lib/leadgen/pruefung';
import { fehler, parseJson } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await erfordereRolle(req, 'lesen');
  if (!auth.ok) return auth.response;
  return NextResponse.json(ladePruefFaelle());
}

/** Unsicheren Treffer entscheiden: dieselbe Firma (zusammenführen) oder verschiedene Firmen (trennen). */
export async function POST(req: Request) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, z.object({ id: z.number().int().positive(), aktion: z.enum(['zusammenfuehren', 'trennen']) }));
  if ('response' in parsed) return parsed.response;
  try {
    entscheidePruefFall(parsed.data.id, parsed.data.aktion);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fehler(e instanceof Error ? e.message : 'Entscheidung fehlgeschlagen', 400);
  }
}
