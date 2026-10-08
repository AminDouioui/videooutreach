import { NextResponse } from 'next/server';
import { sendLead } from '@/lib/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** „Jetzt senden“: ignoriert Fenster und Abstand, respektiert Sperrliste/Abmeldung/Renderstatus. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ ok: false, error: 'Ungültiger Lead' }, { status: 404 });
  const res = await sendLead(id, { force: true });
  if (res.ok) return NextResponse.json({ ok: true });
  return NextResponse.json({ ok: false, error: res.error }, { status: res.kind === 'nicht_gefunden' ? 404 : 200 });
}
