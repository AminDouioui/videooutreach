import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aktualisiereAbsender, entferneAbsender, istSmtp, ladeAbsenderMitId } from '@/lib/absender';
import { aktualisiereSmtpPostfach, smtpAenderungSchema, SmtpEingabeFehler } from '@/lib/absender-smtp';
import { widerrufeToken } from '@/lib/gmail';
import { fehler, parseJson } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

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

// SMTP/IMAP-Felder (Server, Benutzer, Passwörter); leere Passwörter = unverändert. Nur für Postfächer vom Typ smtp.
const smtpFelder = smtpAenderungSchema.pick({
  smtpHost: true,
  smtpPort: true,
  smtpSicherheit: true,
  smtpBenutzer: true,
  smtpPasswort: true,
  imapHost: true,
  imapPort: true,
  imapSicherheit: true,
  imapBenutzer: true,
  imapPasswort: true,
  imapKopieGesendet: true,
});

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Postfach bearbeiten: Name, Tageslimit, Signatur (null/leer = globale), aktiv (pausieren), Rampen-Beginn; bei
 * SMTP/IMAP-Postfächern zusätzlich Server, Benutzer und Passwörter (leer = unverändert).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const id = parseId((await params).id);
  if (id === null || !ladeAbsenderMitId(id)) return fehler('Postfach nicht gefunden', 404);
  const parsed = await parseJson(req, bodySchema.and(smtpFelder));
  if ('response' in parsed) return parsed.response;
  const d = parsed.data;
  const smtpAngaben = Object.fromEntries(Object.entries(d).filter(([k]) => k in smtpFelder.shape));
  const a = ladeAbsenderMitId(id)!;
  if (istSmtp(a)) {
    try {
      aktualisiereSmtpPostfach(id, smtpAngaben);
    } catch (e) {
      if (e instanceof SmtpEingabeFehler) return fehler(e.message, e.status);
      throw e;
    }
  } else if (Object.values(smtpAngaben).some((v) => v !== undefined)) {
    return fehler('Server- und Passwortangaben gelten nur für SMTP/IMAP-Postfächer.');
  }
  const neu = aktualisiereAbsender(id, { ...d, signatur: d.signatur === undefined ? undefined : d.signatur?.replace(/\r\n?/g, '\n').trim() ?? null });
  return NextResponse.json({ ok: true, absender: neu && { id: neu.id, email: neu.email } });
}

/**
 * Postfach entfernen: Token wird bei Google widerrufen und lokal gelöscht. Hängen Leads oder Mails daran, bleibt der
 * Eintrag deaktiviert erhalten (dann wartet deren Follow-up), sonst wird er gelöscht.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const id = parseId((await params).id);
  const a = id === null ? null : ladeAbsenderMitId(id);
  if (id === null || !a) return fehler('Postfach nicht gefunden', 404);
  // Nur Gmail-Zugriffe gibt es bei Google zu widerrufen; SMTP-Zugangsdaten werden lokal gelöscht
  if (!istSmtp(a)) await widerrufeToken(a);
  const ergebnis = entferneAbsender(id);
  return NextResponse.json({ ok: true, ergebnis });
}
