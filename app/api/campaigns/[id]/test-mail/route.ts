import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, schema } from '@/lib/db';
import { ladeAbsender, ladeAbsenderMitId, postfachFuerLead, postfachNichtNutzbar, type Absender } from '@/lib/absender';
import { GmailSendError, sendRaw } from '@/lib/gmail';
import { parseJson } from '@/lib/request';
import { buildLeadMime } from '@/lib/send';
import { STANDARD_VARIANTE } from '@/lib/varianten';
import { ladeVarianten } from '@/lib/varianten-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ leadId: z.number().int().optional(), variante: z.string().max(8).optional(), absenderId: z.number().int().optional() });

/** Testmail vom gewählten Postfach an dessen eigene Adresse („[TEST]“ im Betreff). Ändert keinen Lead-Status. */
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
  // Variante: gewählte, sonst die des Leads, sonst A
  const variante = parsed.data.variante ?? lead.variante ?? STANDARD_VARIANTE;
  if (variante !== STANDARD_VARIANTE && !ladeVarianten(id).some((v) => v.kuerzel === variante)) return fail(`Variante ${variante} existiert nicht`);
  // Postfach: das gewählte, sonst das des Leads, sonst das erste nutzbare
  let absender: Absender | null | undefined;
  if (parsed.data.absenderId !== undefined) absender = ladeAbsenderMitId(parsed.data.absenderId);
  else absender = (lead.absenderId !== null ? postfachFuerLead(lead) : null) ?? ladeAbsender().find((a) => !postfachNichtNutzbar(a));
  if (!absender) return fail(ladeAbsender().length === 0 ? 'Gmail nicht verbunden – bitte unter Einstellungen ein Postfach verbinden' : 'Postfach nicht gefunden');
  const grund = postfachNichtNutzbar(absender);
  if (grund) return fail(grund);

  try {
    await sendRaw(buildLeadMime(lead, kampagne, { to: absender.email, subjectPrefix: `[TEST${variante === STANDARD_VARIANTE ? '' : ` ${variante}`}] `, variante, absender }), undefined, absender);
    return NextResponse.json({ ok: true, to: absender.email });
  } catch (e) {
    return fail(e instanceof GmailSendError ? e.message : e instanceof Error ? e.message : 'Senden fehlgeschlagen');
  }
}
