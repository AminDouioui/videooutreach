import { NextResponse } from 'next/server';
import { z } from 'zod';
import { BENUTZER_ROLLEN } from '@/db/schema';
import { emailSchema, erstelleEinladungFuerNeuenBenutzer } from '@/lib/benutzer';
import { einladungsLink } from '@/lib/einladungs-link';
import { fehler, parseJson } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

const bodySchema = z.object({ email: emailSchema, rolle: z.enum(BENUTZER_ROLLEN) });

/** Einladung erstellen (nur Admin). Der Link steht nur in dieser Antwort; gespeichert wird nur der Hash. */
export async function POST(req: Request) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const e = erstelleEinladungFuerNeuenBenutzer(parsed.data.email, parsed.data.rolle);
  if (!e.ok) return fehler(e.fehler, e.status);
  return NextResponse.json({ id: e.einladung.id, email: e.einladung.email, rolle: e.einladung.rolle, ablaufAt: e.einladung.ablaufAt, link: einladungsLink(e.token) }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
