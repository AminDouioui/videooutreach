import { NextResponse } from 'next/server';
import { z } from 'zod';
import { testeKiVerbindung } from '@/lib/ki-verbindung';
import { parseJson } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';
import { KI_ANBIETER, pruefeKiSchluessel } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// „Verbindung testen“ (nur Admin): minimaler Aufruf beim Anbieter. Mit `schluessel` wird der eingegebene (noch nicht
// gespeicherte) Wert geprüft, sonst der wirksame Schlüssel. Die Antwort enthält nur die Meldung, nie einen Schlüssel.
const bodySchema = z.object({ anbieter: z.enum(KI_ANBIETER), schluessel: z.string().max(2000).optional() });

export async function POST(req: Request) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  let schluessel: string | undefined;
  if (parsed.data.schluessel?.trim()) {
    const p = pruefeKiSchluessel(parsed.data.schluessel);
    if (!p.ok) return NextResponse.json({ ok: false, meldung: p.fehler });
    schluessel = p.wert;
  }
  const ergebnis = await testeKiVerbindung(parsed.data.anbieter, schluessel);
  return NextResponse.json({ ok: ergebnis.ok, meldung: ergebnis.meldung });
}
