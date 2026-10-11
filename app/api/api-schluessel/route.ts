import { NextResponse } from 'next/server';
import { z } from 'zod';
import { API_RECHTE } from '@/db/schema';
import { legeSchluesselAn } from '@/lib/api-schluessel';
import { parseJson } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

const bodySchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(80),
  rechte: z.enum(API_RECHTE),
});

/** API-Schlüssel anlegen. Der Klartext steht nur in dieser Antwort. */
export async function POST(req: Request) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const { schluessel, eintrag } = legeSchluesselAn(parsed.data.name, parsed.data.rechte);
  return NextResponse.json({ id: eintrag.id, schluessel }, { headers: { 'Cache-Control': 'no-store' } });
}
