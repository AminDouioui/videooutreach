import { NextResponse } from 'next/server';
import { dupliziereKampagne } from '@/lib/campaigns';
import { fehler } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

/** Kampagne duplizieren (Vorlage, Einstellungen, Follow-ups, Varianten – ohne Leads) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const kopie = dupliziereKampagne(id);
  if (!kopie) return fehler('Kampagne nicht gefunden', 404);
  return NextResponse.json({ id: kopie.id, name: kopie.name }, { status: 201 });
}
