import { NextResponse } from 'next/server';
import { z } from 'zod';
import { BENUTZER_ROLLEN } from '@/db/schema';
import { aendereRolle, ladeBenutzer, loescheBenutzer, setzeAktiv, type BenutzerOeffentlich } from '@/lib/benutzer';
import { fehler, parseJson } from '@/lib/request';
import { erfordereRolle, setzeSessionCookie } from '@/lib/session';

export const runtime = 'nodejs';

const bodySchema = z.object({ rolle: z.enum(BENUTZER_ROLLEN), aktiv: z.boolean() }).partial();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Rolle ändern und/oder (de)aktivieren (nur Admin). Beides entwertet die bestehenden Sessions des Benutzers sofort. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const id = parseId((await params).id);
  if (id === null || !ladeBenutzer(id)) return fehler('Benutzer nicht gefunden', 404);
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const { rolle, aktiv } = parsed.data;
  if (rolle === undefined && aktiv === undefined) return fehler('Nichts zu ändern');

  let benutzer: BenutzerOeffentlich | undefined;
  if (rolle !== undefined) {
    const r = aendereRolle(id, rolle, auth.benutzer.id);
    if (!r.ok) return fehler(r.fehler, r.status);
    benutzer = r.benutzer;
  }
  if (aktiv !== undefined) {
    const r = setzeAktiv(id, aktiv, auth.benutzer.id);
    if (!r.ok) return fehler(r.fehler, r.status);
    benutzer = r.benutzer;
  }
  const res = NextResponse.json({ ok: true, benutzer });
  // Ändert ein Admin sich selbst (z. B. nur die Rolle), bekommt er ein Token mit der neuen Version
  if (benutzer && id === auth.benutzer.id && benutzer.aktiv) await setzeSessionCookie(res, { benutzerId: id, rolle: benutzer.rolle, version: benutzer.sessionVersion });
  return res;
}

/** Benutzer löschen (nur Admin; nicht sich selbst). Bestehende Sessions werden ungültig, weil der Benutzer fehlt. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const id = parseId((await params).id);
  if (id === null) return fehler('Benutzer nicht gefunden', 404);
  const r = loescheBenutzer(id, auth.benutzer.id);
  if (!r.ok) return fehler(r.fehler, r.status);
  return NextResponse.json({ ok: true });
}
