import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aktualisiereAbsender, entferneAbsender, ladeAbsenderMitId } from '@/lib/absender';
import { widerrufeToken } from '@/lib/gmail';
import { fehler, parseJson } from '@/lib/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    name: z.string().trim().max(200).nullable(),
    tageslimit: z.coerce.number().int().min(1).max(2000),
    signatur: z.string().max(5000).nullable(),
    aktiv: z.boolean(),
    rampeBeginn: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT')]).nullable(),
  })
  .partial();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Postfach bearbeiten: Name, Tageslimit, Signatur (null/leer = globale), aktiv (pausieren), Rampen-Beginn. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null || !ladeAbsenderMitId(id)) return fehler('Postfach nicht gefunden', 404);
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const d = parsed.data;
  const neu = aktualisiereAbsender(id, { ...d, signatur: d.signatur === undefined ? undefined : d.signatur?.replace(/\r\n?/g, '\n').trim() ?? null });
  return NextResponse.json({ ok: true, absender: neu && { id: neu.id, email: neu.email } });
}

/**
 * Postfach entfernen: Token wird bei Google widerrufen und lokal gelöscht. Hängen Leads oder Mails daran, bleibt der
 * Eintrag deaktiviert erhalten (dann wartet deren Follow-up), sonst wird er gelöscht.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  const a = id === null ? null : ladeAbsenderMitId(id);
  if (id === null || !a) return fehler('Postfach nicht gefunden', 404);
  await widerrufeToken(a);
  const ergebnis = entferneAbsender(id);
  return NextResponse.json({ ok: true, ergebnis });
}
