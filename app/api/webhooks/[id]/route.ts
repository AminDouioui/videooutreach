import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WEBHOOK_EREIGNISSE } from '@/db/schema';
import { getDb, schema } from '@/lib/db';
import { fehler, parseJson } from '@/lib/request';
import { pruefeWebhookZiel } from '@/lib/webhook-logik';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    aktiv: z.boolean().optional(),
    url: z.string().trim().min(1).max(2000).optional(),
    ereignisse: z.array(z.enum(WEBHOOK_EREIGNISSE)).min(1, 'Mindestens ein Ereignis wählen').optional(),
  })
  .refine((v) => v.aktiv !== undefined || v.url !== undefined || v.ereignisse !== undefined, 'Nichts zu ändern');

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige ID', 404);
  const parsed = await parseJson(req, patchSchema);
  if ('response' in parsed) return parsed.response;
  const db = getDb();
  if (!db.select({ id: schema.webhooks.id }).from(schema.webhooks).where(eq(schema.webhooks.id, id)).get()) return fehler('Webhook nicht gefunden', 404);
  const set: Partial<typeof schema.webhooks.$inferInsert> = {};
  if (parsed.data.aktiv !== undefined) set.aktiv = parsed.data.aktiv;
  if (parsed.data.ereignisse) set.ereignisse = [...new Set(parsed.data.ereignisse)];
  if (parsed.data.url !== undefined) {
    const ziel = await pruefeWebhookZiel(parsed.data.url);
    if (!ziel.ok) return fehler(ziel.grund);
    set.url = parsed.data.url;
  }
  db.update(schema.webhooks).set(set).where(eq(schema.webhooks.id, id)).run();
  return NextResponse.json({ ok: true });
}

/** Webhook samt Protokoll löschen (Cascade). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige ID', 404);
  const res = getDb().delete(schema.webhooks).where(eq(schema.webhooks.id, id)).run();
  if (res.changes === 0) return fehler('Webhook nicht gefunden', 404);
  return NextResponse.json({ ok: true });
}
