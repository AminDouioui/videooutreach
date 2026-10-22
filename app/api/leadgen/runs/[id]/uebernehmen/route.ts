import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UEBERNAHME_LABEL, uebernehmeInKampagne } from '@/lib/leadgen/uebernahme';
import { fehler, parseJson } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  campaignId: z.number().int().positive(),
  companyIds: z.array(z.number().int().positive()).min(1).max(2000),
  // Standard: nur verifizierte E-Mails. Weitere Status (best guess, generisch) nur auf ausdrücklichen Wunsch.
  statusErlaubt: z.array(z.enum(['gueltig', 'catch_all_best_guess', 'generisch', 'generisch_unverifiziert'])).min(1).optional(),
});

/** Ausgewählte Ergebnisse in eine Kampagne übernehmen (mit Dedup und Sperrlisten-Abgleich). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const runId = Number((await params).id);
  if (!Number.isInteger(runId)) return fehler('Ungültiger Lauf', 404);
  const parsed = await parseJson(req, schema);
  if ('response' in parsed) return parsed.response;
  try {
    const r = uebernehmeInKampagne({ runId, ...parsed.data, benutzer: auth.benutzer.name });
    return NextResponse.json({ ...r, zeilen: r.zeilen.map((z) => ({ ...z, text: UEBERNAHME_LABEL[z.status] })) });
  } catch (e) {
    return fehler(e instanceof Error ? e.message : 'Übernahme fehlgeschlagen', 400);
  }
}
