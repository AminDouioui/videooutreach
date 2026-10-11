import { NextResponse } from 'next/server';
import { sendLead } from '@/lib/send';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** „Jetzt senden“: ignoriert Fenster und Abstand, respektiert Sperrliste/Abmeldung/Renderstatus. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ ok: false, error: 'Ungültiger Lead' }, { status: 404 });
  const res = await sendLead(id, { force: true });
  if (res.ok) return NextResponse.json({ ok: true });
  return NextResponse.json({ ok: false, error: res.error }, { status: res.kind === 'nicht_gefunden' ? 404 : 200 });
}
