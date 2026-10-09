import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, schema } from '@/lib/db';
import { fehler, parseJson } from '@/lib/request';
import { pruefeVariante, varianteSchema } from '@/lib/varianten-db';

export const runtime = 'nodejs';

async function lade(params: Promise<{ id: string; vid: string }>) {
  const p = await params;
  const id = Number(p.id);
  const vid = Number(p.vid);
  if (!Number.isInteger(id) || !Number.isInteger(vid)) return null;
  return getDb().select().from(schema.varianten).where(and(eq(schema.varianten.id, vid), eq(schema.varianten.campaignId, id))).get() ?? null;
}

/** Variante ändern (Betreff, Text, aktiv) */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string; vid: string }> }) {
  const v = await lade(params);
  if (!v) return fehler('Variante nicht gefunden', 404);
  const parsed = await parseJson(req, varianteSchema);
  if ('response' in parsed) return parsed.response;
  const p = pruefeVariante(v.campaignId, parsed.data.betreff, parsed.data.text);
  if (p.fehler) return fehler(p.fehler);
  getDb()
    .update(schema.varianten)
    .set({ betreff: parsed.data.betreff, text: parsed.data.text, aktiv: parsed.data.aktiv ?? v.aktiv })
    .where(eq(schema.varianten.id, v.id))
    .run();
  return NextResponse.json({ ok: true, warnungen: p.warnungen });
}

/** Variante löschen – nur, solange kein Lead sie bekommen hat (sonst nur deaktivieren) */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; vid: string }> }) {
  const v = await lade(params);
  if (!v) return fehler('Variante nicht gefunden', 404);
  const n = getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(eq(schema.leads.campaignId, v.campaignId), eq(schema.leads.variante, v.kuerzel)))
    .get()?.n ?? 0;
  if (n > 0) return fehler(`Variante ${v.kuerzel} wurde bereits an ${n} Lead(s) gesendet und kann nur deaktiviert werden`, 409);
  getDb().delete(schema.varianten).where(eq(schema.varianten.id, v.id)).run();
  return NextResponse.json({ ok: true });
}
