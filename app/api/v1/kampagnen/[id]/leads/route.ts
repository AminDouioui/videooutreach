import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { apiFehler, pruefeApiZugriff } from '@/lib/api-schluessel';
import { apiLeadSchema, apiLeadsBodySchema, ladeLeadsSeite, legeLeadsPerApiAn } from '@/lib/api-v1';
import { getDb, schema } from '@/lib/db';
import { istLeadStatus, LEAD_STATUS } from '@/lib/lead-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function kampagneId(roh: string): number | null {
  const id = Number(roh);
  if (!Number.isInteger(id)) return null;
  return getDb().select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, id)).get()?.id ?? null;
}

/** GET /api/v1/kampagnen/{id}/leads?seite=1&status=interessiert – Leads seitenweise (Recht: lesen) */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = pruefeApiZugriff(req, 'lesen');
  if (!auth.ok) return auth.response;
  const id = kampagneId((await params).id);
  if (id === null) return apiFehler('Kampagne nicht gefunden', 404);
  const q = new URL(req.url).searchParams;
  const seiteRoh = q.get('seite');
  const seite = seiteRoh === null ? 1 : Number(seiteRoh);
  if (!Number.isInteger(seite) || seite < 1) return apiFehler('Ungültige Seite (ganze Zahl ab 1)', 400);
  const status = q.get('status') || undefined;
  if (status && !istLeadStatus(status)) return apiFehler(`Ungültiger Status (erlaubt: ${LEAD_STATUS.join(', ')})`, 400);
  return NextResponse.json(ladeLeadsSeite(id, seite, status), { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * POST /api/v1/kampagnen/{id}/leads – ein oder mehrere Leads anlegen (Recht: schreiben).
 * Body: {"leads":[{firma,email,vorname,…}]} oder ein einzelner Lead {firma,email,…}.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = pruefeApiZugriff(req, 'schreiben');
  if (!auth.ok) return auth.response;
  const id = kampagneId((await params).id);
  if (id === null) return apiFehler('Kampagne nicht gefunden', 404);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiFehler('Ungültiger Request-Body (JSON erwartet)', 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return apiFehler('Erwartet {"leads":[…]} oder einen einzelnen Lead', 400);
  if (!('leads' in body) && !('email' in body) && !('firma' in body)) return apiFehler('Erwartet {"leads":[…]} oder einen einzelnen Lead mit firma und email', 400);
  const parsed = 'leads' in body ? apiLeadsBodySchema.safeParse(body) : apiLeadSchema.safeParse(body);
  if (!parsed.success) return apiFehler(`Ungültige Eingabe: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'body'} ${i.message}`).join('; ')}`, 400);
  const data = parsed.data as Record<string, unknown>;
  const leads = ('leads' in data ? data.leads : [data]) as Record<string, string>[];
  const opt = 'leads' in data ? { einProFirma: data.einProFirma as boolean | undefined, mxTrotzdem: data.mxTrotzdem as boolean | undefined } : {};
  const ergebnis = await legeLeadsPerApiAn(id, leads, opt);
  return NextResponse.json(ergebnis, { status: ergebnis.angelegt > 0 ? 201 : 200, headers: { 'Cache-Control': 'no-store' } });
}
