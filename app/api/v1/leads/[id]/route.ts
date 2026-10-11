import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiFehler, pruefeApiZugriff } from '@/lib/api-schluessel';
import { leadDto } from '@/lib/api-v1';
import { getDb, schema } from '@/lib/db';
import { LEAD_STATUS } from '@/lib/lead-status';
import { setzeLeadStatus } from '@/lib/lead-status-db';
import { parseDealWert } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ladeLead = (id: number) => (Number.isInteger(id) ? (getDb().select().from(schema.leads).where(eq(schema.leads.id, id)).get() ?? null) : null);

/** GET /api/v1/leads/{id} (Recht: lesen) */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = pruefeApiZugriff(req, 'lesen');
  if (!auth.ok) return auth.response;
  const lead = ladeLead(Number((await params).id));
  if (!lead) return apiFehler('Lead nicht gefunden', 404);
  return NextResponse.json({ lead: leadDto(lead) }, { headers: { 'Cache-Control': 'no-store' } });
}

const patchSchema = z
  .object({
    leadStatus: z.enum(LEAD_STATUS).optional(),
    notizen: z.string().max(10_000).nullable().optional(),
    // Deal-Wert in Euro (Zahl oder Text wie „1.234,50 €“); null = löschen
    dealWert: z.union([z.string().max(40), z.number(), z.null()]).optional(),
  })
  .strict()
  .refine((v) => v.leadStatus !== undefined || v.notizen !== undefined || v.dealWert !== undefined, 'Nichts zu ändern (erlaubt: leadStatus, notizen, dealWert)');

/**
 * PATCH /api/v1/leads/{id} {leadStatus, notizen, dealWert} (Recht: schreiben). Der Lead-Status läuft über dieselbe
 * zentrale Funktion wie im Dashboard (Flow-Stopp, Untersequenzen, Webhook).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = pruefeApiZugriff(req, 'schreiben');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!ladeLead(id)) return apiFehler('Lead nicht gefunden', 404);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiFehler('Ungültiger Request-Body (JSON erwartet)', 400);
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return apiFehler(`Ungültige Eingabe: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'body'} ${i.message}`).join('; ')}`, 400);
  const d = parsed.data;
  const set: Partial<typeof schema.leads.$inferInsert> = {};
  if (d.dealWert !== undefined) {
    const w = parseDealWert(d.dealWert);
    if (!w.ok) return apiFehler('Ungültiger Deal-Wert (z. B. 1234.5 oder „1.234,50 €“)', 400);
    set.dealWert = w.cent;
  }
  if (d.notizen !== undefined) set.notizen = d.notizen?.trim() || null;
  if (Object.keys(set).length > 0) getDb().update(schema.leads).set(set).where(eq(schema.leads.id, id)).run();
  // Lead-Status zuletzt: berücksichtigt den Zustand nach den übrigen Änderungen
  if (d.leadStatus) setzeLeadStatus(id, d.leadStatus);
  return NextResponse.json({ lead: leadDto(ladeLead(id)!) }, { headers: { 'Cache-Control': 'no-store' } });
}
