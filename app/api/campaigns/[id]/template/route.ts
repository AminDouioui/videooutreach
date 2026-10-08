import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, schema } from '@/lib/db';
import { fehler, parseJson } from '@/lib/request';

export const runtime = 'nodejs';

const bodySchema = z.object({
  subject: z.string().trim().min(1, 'Betreff fehlt').max(300),
  body: z.string().trim().min(1, 'Text fehlt').max(20000),
});

/** Mail-Vorlage (Betreff + Text) der Kampagne speichern */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const res = getDb()
    .update(schema.campaigns)
    .set({ emailSubjectTemplate: parsed.data.subject, emailBodyTemplate: parsed.data.body })
    .where(eq(schema.campaigns.id, id))
    .run();
  if (res.changes === 0) return fehler('Kampagne nicht gefunden', 404);
  return NextResponse.json({ ok: true });
}
