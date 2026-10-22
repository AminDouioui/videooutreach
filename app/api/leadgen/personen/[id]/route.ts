import { NextResponse } from 'next/server';
import { loeschePerson } from '@/lib/leadgen/sperre';
import { fehler } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Person löschen (DSGVO): Daten und Kontakte weg, Adresse auf die Sperrliste, Wiederauftauchen blockiert. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Person', 404);
  try {
    return NextResponse.json({ ok: true, ...loeschePerson(id, { grund: 'datenloeschung' }) });
  } catch (e) {
    return fehler(e instanceof Error ? e.message : 'Löschen fehlgeschlagen', 404);
  }
}
