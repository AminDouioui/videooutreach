import { NextResponse } from 'next/server';
import { loescheKampagne } from '@/lib/campaigns';
import { fehler } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

/** Kampagne endgültig löschen (inkl. Leads, Tracking, Follow-ups und gerenderter Videos). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const res = loescheKampagne(id);
  if (!res) return fehler('Kampagne nicht gefunden', 404);
  return NextResponse.json({ ok: true, ...res });
}
