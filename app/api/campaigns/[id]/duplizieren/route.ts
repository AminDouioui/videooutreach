import { NextResponse } from 'next/server';
import { dupliziereKampagne } from '@/lib/campaigns';
import { fehler } from '@/lib/request';

export const runtime = 'nodejs';

/** Kampagne duplizieren (Vorlage, Einstellungen, Follow-ups, Varianten – ohne Leads) */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const kopie = dupliziereKampagne(id);
  if (!kopie) return fehler('Kampagne nicht gefunden', 404);
  return NextResponse.json({ id: kopie.id, name: kopie.name }, { status: 201 });
}
