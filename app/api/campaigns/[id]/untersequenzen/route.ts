import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fehler, parseJson } from '@/lib/request';
import { ladeRegeln, legeRegelAn, type RegelFehler } from '@/lib/untersequenzen-db';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

const FEHLER_TEXT: Record<RegelFehler, string> = {
  status: 'Ungültiger Auslöser-Status',
  quelle: 'Kampagne nicht gefunden',
  ziel: 'Ziel-Kampagne nicht gefunden',
  gleich: 'Ziel-Kampagne muss eine andere Kampagne sein',
  doppelt: 'Diese Regel gibt es schon',
};

const bodySchema = z.object({ ausloeserStatus: z.string().max(40), zielCampaignId: z.number().int() });

async function ladeId(params: Promise<{ id: string }>) {
  const id = Number((await params).id);
  return Number.isInteger(id) ? id : null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'lesen');
  if (!auth.ok) return auth.response;
  const id = await ladeId(params);
  if (id === null) return fehler('Ungültige Kampagne', 404);
  return NextResponse.json({ regeln: ladeRegeln(id) });
}

/** Regel anlegen: Lead-Status → Ziel-Kampagne */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const id = await ladeId(params);
  if (id === null) return fehler('Ungültige Kampagne', 404);
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const r = legeRegelAn(id, parsed.data.ausloeserStatus, parsed.data.zielCampaignId);
  if (!r.ok) return fehler(FEHLER_TEXT[r.fehler], r.fehler === 'quelle' ? 404 : 400);
  return NextResponse.json({ ok: true, id: r.id, regeln: ladeRegeln(id) });
}
