import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, schema } from '@/lib/db';
import { fordereRenderAn } from '@/lib/render-queue';
import { fehler, parseJson } from '@/lib/request';

export const runtime = 'nodejs';

const bodySchema = z.object({ mode: z.enum(['all', 'failed']) });

/** Leads einer Kampagne in die Render-Warteschlange stellen. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const k = getDb().select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) return fehler('Kampagne nicht gefunden', 404);
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const queued = fordereRenderAn(id, parsed.data.mode);
  return NextResponse.json({ queued });
}
