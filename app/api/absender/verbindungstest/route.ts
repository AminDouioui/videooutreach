import { NextResponse } from 'next/server';
import { konfigFuerTest, smtpTestSchema, SmtpEingabeFehler } from '@/lib/absender-smtp';
import { fehler, parseJson } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';
import { testeVerbindung } from '@/lib/smtp-treiber';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * „Verbindung testen“ (nur Admin): meldet sich am SMTP- und am IMAP-Server an und beschreibt das Ergebnis. Es wird nichts
 * gesendet und nichts gespeichert. Mit `absenderId` gelten leere Passwortfelder als „gespeicherte verwenden“.
 * Die Antwort enthält nie Passwörter.
 */
export async function POST(req: Request) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, smtpTestSchema);
  if ('response' in parsed) return parsed.response;
  try {
    const ergebnis = await testeVerbindung(konfigFuerTest(parsed.data));
    return NextResponse.json({ ok: ergebnis.smtp.ok && ergebnis.imap.ok, ...ergebnis });
  } catch (e) {
    if (e instanceof SmtpEingabeFehler) return fehler(e.message, e.status);
    throw e;
  }
}
