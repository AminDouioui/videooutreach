import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fehler, parseJson } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';
import { kiSchluesselStatus } from '@/lib/settings-view';
import { KI_ANBIETER, loescheKiSchluessel, pruefeKiSchluessel, setzeKiSchluessel } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// KI-API-Schlüssel setzen/entfernen (nur Admin). Die Antworten enthalten nie einen Schlüssel, nur den maskierten Zustand
// („…abcd“). Der Schlüssel wird verschlüsselt gespeichert (lib/crypto.ts) und nicht geloggt.

const putSchema = z.object({ anbieter: z.enum(KI_ANBIETER), schluessel: z.string().max(2000) });
const deleteSchema = z.object({ anbieter: z.enum(KI_ANBIETER) });

export async function PUT(req: Request) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, putSchema);
  if ('response' in parsed) return parsed.response;
  const pruefung = pruefeKiSchluessel(parsed.data.schluessel);
  if (!pruefung.ok) return fehler(pruefung.fehler, 400);
  setzeKiSchluessel(parsed.data.anbieter, pruefung.wert);
  return NextResponse.json({ ok: true, kiSchluessel: kiSchluesselStatus(true) });
}

export async function DELETE(req: Request) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, deleteSchema);
  if ('response' in parsed) return parsed.response;
  loescheKiSchluessel(parsed.data.anbieter);
  return NextResponse.json({ ok: true, kiSchluessel: kiSchluesselStatus(true) });
}
