import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, schema } from '@/lib/db';
import { GmailSendError, isGmailConnected, sendRaw } from '@/lib/gmail';
import { parseJson } from '@/lib/request';
import { buildLeadMime, senderInfo } from '@/lib/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ leadId: z.number().int().optional() });

/** Testmail an den Absender selbst („[TEST]“ im Betreff). Ändert keinen Lead-Status. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const fail = (error: string, status = 200) => NextResponse.json({ ok: false, error }, { status });
  if (!Number.isInteger(id)) return fail('Ungültige Kampagne', 404);
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return fail('Ungültiger Request-Body', 400);

  const db = getDb();
  const kampagne = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!kampagne) return fail('Kampagne nicht gefunden', 404);
  const lead = parsed.data.leadId
    ? db.select().from(schema.leads).where(eq(schema.leads.id, parsed.data.leadId)).get()
    : db.select().from(schema.leads).where(eq(schema.leads.campaignId, id)).limit(1).get();
  if (!lead || lead.campaignId !== id) return fail('Kein Lead für die Testmail vorhanden');
  const absender = senderInfo();
  if (!absender.email) return fail('SENDER_EMAIL ist nicht gesetzt');
  if (!isGmailConnected()) return fail('Gmail nicht verbunden');

  try {
    await sendRaw(buildLeadMime(lead, kampagne, { to: absender.email, subjectPrefix: '[TEST] ' }));
    return NextResponse.json({ ok: true, to: absender.email });
  } catch (e) {
    return fail(e instanceof GmailSendError ? e.message : e instanceof Error ? e.message : 'Senden fehlgeschlagen');
  }
}
