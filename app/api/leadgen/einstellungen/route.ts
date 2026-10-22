import { NextResponse } from 'next/server';
import { z } from 'zod';
import { encrypt } from '@/lib/crypto';
import { deleteSetting, getSetting, setSetting } from '@/lib/settings';
import { braveSchluessel } from '@/lib/leadgen/search/brave';
import { extraktionsModell } from '@/lib/leadgen/extract/openai-provider';
import { ladeRollenDefinitionen, pruefeVoraussetzungen } from '@/lib/leadgen/standard-deps';
import { fehler, parseJson } from '@/lib/request';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await erfordereRolle(req, 'lesen');
  if (!auth.ok) return auth.response;
  const schluessel = braveSchluessel();
  return NextResponse.json({ voraussetzungen: pruefeVoraussetzungen(), braveGesetzt: !!schluessel, extraktionModell: extraktionsModell(), rollen: ladeRollenDefinitionen().map((r) => ({ key: r.key, label: r.label })) });
}

const schema = z.object({ braveSchluessel: z.string().trim().max(300).optional(), extraktionModell: z.string().trim().max(100).optional() });

/** Brave-Schlüssel (verschlüsselt gespeichert) und Extraktionsmodell setzen; leerer Wert entfernt die App-Einstellung. Nur Admins. */
export async function PUT(req: Request) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, schema);
  if ('response' in parsed) return parsed.response;
  const { braveSchluessel: key, extraktionModell: modell } = parsed.data;
  if (key !== undefined) {
    if (key === '') deleteSetting('brave_api_key');
    else if (/[\s\u0000-\u001f]/.test(key)) return fehler('Der Schlüssel darf keine Leerzeichen oder Zeilenumbrüche enthalten.');
    else setSetting('brave_api_key', encrypt(key));
  }
  if (modell !== undefined) {
    if (modell === '') deleteSetting('extraktion_modell');
    else setSetting('extraktion_modell', modell);
  }
  return NextResponse.json({ ok: true, braveGesetzt: getSetting('brave_api_key') !== null || !!braveSchluessel() });
}
