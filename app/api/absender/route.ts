import { NextResponse } from 'next/server';
import { legeSmtpPostfachAn, smtpNeuSchema, SmtpEingabeFehler } from '@/lib/absender-smtp';
import { fehler, parseJson } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SMTP/IMAP-Postfach hinzufügen (nur Admin; die Server-Hosts sind frei wählbar, deshalb keine geringere Rolle).
 * Die Passwörter werden verschlüsselt gespeichert und in keiner Antwort zurückgegeben.
 */
export async function POST(req: Request) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, smtpNeuSchema);
  if ('response' in parsed) return parsed.response;
  try {
    const a = legeSmtpPostfachAn(parsed.data);
    return NextResponse.json({ ok: true, absender: { id: a.id, email: a.email } }, { status: 201 });
  } catch (e) {
    if (e instanceof SmtpEingabeFehler) return fehler(e.message, e.status);
    throw e;
  }
}
