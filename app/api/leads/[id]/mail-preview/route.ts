import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, schema } from '@/lib/db';
import { fehler } from '@/lib/request';
import { buildLeadEmail } from '@/lib/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vorschau der Mail für einen Lead: { subject, html, text } */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültiger Lead', 404);
  const db = getDb();
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, id)).get();
  if (!lead) return fehler('Lead nicht gefunden', 404);
  const kampagne = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
  if (!kampagne) return fehler('Kampagne nicht gefunden', 404);

  const mail = buildLeadEmail(lead, kampagne);
  return NextResponse.json(mail);
}

/** Vorschau mit noch nicht gespeicherter Vorlage: Body { subject, body, followupBody? } (mit followupBody: Follow-up im Thread) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültiger Lead', 404);
  const db = getDb();
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, id)).get();
  if (!lead) return fehler('Lead nicht gefunden', 404);
  const kampagne = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
  if (!kampagne) return fehler('Kampagne nicht gefunden', 404);
  let body: { subject?: unknown; body?: unknown; followupBody?: unknown; followupNr?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return fehler('Ungültiger Request-Body');
  }
  const mail = buildLeadEmail(
    lead,
    {
      ...kampagne,
      emailSubjectTemplate: typeof body.subject === 'string' ? body.subject.slice(0, 500) : kampagne.emailSubjectTemplate,
      emailBodyTemplate: typeof body.body === 'string' ? body.body.slice(0, 20000) : kampagne.emailBodyTemplate,
    },
    typeof body.followupBody === 'string' ? { body: body.followupBody.slice(0, 20000), nr: typeof body.followupNr === 'number' && body.followupNr >= 1 ? Math.floor(body.followupNr) : 1 } : undefined,
  );
  return NextResponse.json(mail);
}
