import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { getDb, schema } from '@/lib/db';
import { fehler, parseJson } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({ erledigt: z.boolean() });

/** Weiterleitungs-Entwurf als erledigt markieren bzw. wieder öffnen (gesendet wird nie aus der App). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige ID', 404);
  const parsed = await parseJson(req, patchSchema);
  if ('response' in parsed) return parsed.response;
  const res = getDb()
    .update(schema.vertretungsEntwuerfe)
    .set({ erledigtAt: parsed.data.erledigt ? new Date() : null })
    .where(eq(schema.vertretungsEntwuerfe.id, id))
    .returning({ id: schema.vertretungsEntwuerfe.id })
    .get();
  if (!res) return fehler('Entwurf nicht gefunden', 404);
  return NextResponse.json({ ok: true });
}
