import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fehler, parseJson } from '@/lib/request';
import { loescheRegel, setzeRegelAktiv } from '@/lib/untersequenzen-db';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

async function ladeIds(params: Promise<{ id: string; rid: string }>) {
  const p = await params;
  const id = Number(p.id);
  const rid = Number(p.rid);
  return Number.isInteger(id) && Number.isInteger(rid) ? { id, rid } : null;
}

/** Regel aktivieren/deaktivieren */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const ids = await ladeIds(params);
  if (!ids) return fehler('Ungültige ID', 404);
  const parsed = await parseJson(req, z.object({ aktiv: z.boolean() }));
  if ('response' in parsed) return parsed.response;
  if (!setzeRegelAktiv(ids.id, ids.rid, parsed.data.aktiv)) return fehler('Regel nicht gefunden', 404);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const ids = await ladeIds(params);
  if (!ids) return fehler('Ungültige ID', 404);
  if (!loescheRegel(ids.id, ids.rid)) return fehler('Regel nicht gefunden', 404);
  return NextResponse.json({ ok: true });
}
