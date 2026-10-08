import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, schema } from '@/lib/db';
import { deleteMedia } from '@/lib/media';
import { fehler, parseJson } from '@/lib/request';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    notizen: z.string().max(10_000).optional(),
    sendStatus: z.literal('uebersprungen').optional(),
  })
  .refine((v) => v.notizen !== undefined || v.sendStatus !== undefined, 'Nichts zu ändern');

async function ladeId(params: Promise<{ id: string }>) {
  const id = Number((await params).id);
  return Number.isInteger(id) ? id : null;
}

/** Notizen speichern oder Lead überspringen. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await ladeId(params);
  if (id === null) return fehler('Ungültige ID', 404);
  const parsed = await parseJson(req, patchSchema);
  if ('response' in parsed) return parsed.response;
  const db = getDb();
  const lead = db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.id, id)).get();
  if (!lead) return fehler('Lead nicht gefunden', 404);

  const set: Partial<typeof schema.leads.$inferInsert> = {};
  if (parsed.data.notizen !== undefined) set.notizen = parsed.data.notizen.trim() || null;
  if (parsed.data.sendStatus) {
    set.sendStatus = 'uebersprungen';
    set.sendError = null;
  }
  db.update(schema.leads).set(set).where(eq(schema.leads.id, id)).run();
  return NextResponse.json({ ok: true });
}

/** Lead inkl. Events (Cascade) und Mediendateien löschen. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await ladeId(params);
  if (id === null) return fehler('Ungültige ID', 404);
  const db = getDb();
  const lead = db.select({ slug: schema.leads.slug, campaignId: schema.leads.campaignId }).from(schema.leads).where(eq(schema.leads.id, id)).get();
  if (!lead) return fehler('Lead nicht gefunden', 404);
  db.delete(schema.events).where(eq(schema.events.leadId, id)).run();
  db.delete(schema.leads).where(eq(schema.leads.id, id)).run();
  deleteMedia(lead.slug);
  return NextResponse.json({ ok: true, campaignId: lead.campaignId });
}
