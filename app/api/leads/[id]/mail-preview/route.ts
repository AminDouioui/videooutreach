import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, schema } from '@/lib/db';
import { fehler } from '@/lib/request';
import { buildLeadEmail } from '@/lib/send';
import { STANDARD_VARIANTE } from '@/lib/varianten';
import { kampagneMitVariante, ladeVarianten, vorschauVariante } from '@/lib/varianten-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Gewünschtes Kürzel prüfen: gültig = A oder vorhandene Zusatzvariante der Kampagne */
function gueltigeVariante(campaignId: number, v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  return v === STANDARD_VARIANTE || ladeVarianten(campaignId).some((x) => x.kuerzel === v) ? v : null;
}

/**
 * Vorschau der Mail für einen Lead: { subject, html, text, variante }. Zeigt die Variante des Leads bzw. die, die er
 * beim Versand bekäme; mit `?variante=B` eine bestimmte.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültiger Lead', 404);
  const db = getDb();
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, id)).get();
  if (!lead) return fehler('Lead nicht gefunden', 404);
  const kampagne = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
  if (!kampagne) return fehler('Kampagne nicht gefunden', 404);

  const variante = vorschauVariante(lead, gueltigeVariante(kampagne.id, new URL(req.url).searchParams.get('variante')));
  const mail = buildLeadEmail(lead, kampagne, undefined, variante);
  return NextResponse.json({ ...mail, variante });
}

/** Vorschau mit noch nicht gespeicherter Vorlage: Body { subject, body, followupBody?, variante? } (mit followupBody: Follow-up im Thread; ohne subject/body gilt die Vorlage der Variante) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültiger Lead', 404);
  const db = getDb();
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, id)).get();
  if (!lead) return fehler('Lead nicht gefunden', 404);
  const kampagne = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
  if (!kampagne) return fehler('Kampagne nicht gefunden', 404);
  let body: { subject?: unknown; body?: unknown; followupBody?: unknown; followupNr?: unknown; variante?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return fehler('Ungültiger Request-Body');
  }
  const variante = vorschauVariante(lead, gueltigeVariante(kampagne.id, body.variante));
  const basis = kampagneMitVariante(kampagne, variante);
  const mail = buildLeadEmail(
    lead,
    {
      ...basis,
      emailSubjectTemplate: typeof body.subject === 'string' ? body.subject.slice(0, 500) : basis.emailSubjectTemplate,
      emailBodyTemplate: typeof body.body === 'string' ? body.body.slice(0, 20000) : basis.emailBodyTemplate,
    },
    typeof body.followupBody === 'string' ? { body: body.followupBody.slice(0, 20000), nr: typeof body.followupNr === 'number' && body.followupNr >= 1 ? Math.floor(body.followupNr) : 1 } : undefined,
    STANDARD_VARIANTE, // Vorlage der Variante steckt bereits in `basis`
  );
  return NextResponse.json({ ...mail, variante });
}
