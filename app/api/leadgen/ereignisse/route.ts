import { NextResponse } from 'next/server';
import { z } from 'zod';
import { EREIGNIS_LABEL, ladeEreignisse, markiereEreignis } from '@/lib/leadgen/ereignisse';
import { getDb, schema } from '@/lib/db';
import { starteAnreicherungFuerFirma } from '@/lib/leadgen/refresh';
import { ladeRollenDefinitionen } from '@/lib/leadgen/standard-deps';
import { fehler, parseJson } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ereignisse aus dem Handelsregister (Geschäftsführerwechsel, Neueintragungen) als Outreach-Trigger. */
export async function GET(req: Request) {
  const auth = await erfordereRolle(req, 'lesen');
  if (!auth.ok) return auth.response;
  const nurNeue = new URL(req.url).searchParams.get('alle') !== '1';
  return NextResponse.json(ladeEreignisse({ nurNeue, limit: 100 }).map((e) => ({ ...e, text: EREIGNIS_LABEL[e.typ] })));
}

const schema_ = z.object({ id: z.number().int().positive(), aktion: z.enum(['gesehen', 'anreichern']), rolle: z.string().max(60).optional() });

/** „gesehen“ blendet das Ereignis aus; „anreichern“ startet die Kontaktsuche für die Firma neu (z. B. für den neuen Geschäftsführer). */
export async function POST(req: Request) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, schema_);
  if ('response' in parsed) return parsed.response;
  const { id, aktion } = parsed.data;
  const e = getDb().select().from(schema.registerEreignisse).where(eq(schema.registerEreignisse.id, id)).get();
  if (!e) return fehler('Ereignis nicht gefunden', 404);
  if (aktion === 'gesehen') {
    markiereEreignis(id, 'gesehen');
    return NextResponse.json({ ok: true });
  }
  const rolle = parsed.data.rolle ?? 'einkauf_leitung';
  if (!ladeRollenDefinitionen().some((r) => r.key === rolle)) return fehler('Unbekannte Zielrolle');
  // Die Firma kann erst angereichert werden, wenn die Entity Resolution sie kennt
  const eintrag = ladeEreignisse({ limit: 500 }).find((x) => x.id === id);
  if (!eintrag?.companyId) return fehler('Die Firma ist noch nicht im Bestand aufgelöst (erst einen Lauf starten).', 400);
  const runId = starteAnreicherungFuerFirma(eintrag.companyId, rolle);
  markiereEreignis(id, 'angereichert');
  return NextResponse.json({ ok: true, runId });
}
