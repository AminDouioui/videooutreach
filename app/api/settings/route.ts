import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ladeEinstellungen } from '@/lib/settings-view';
import { parseJson } from '@/lib/request';
import { deleteSetting, KI_AUTO_STATUS, KI_ENTWURF_ANBIETER, KI_KLASSIFIZIERER, verfuegbareEntwurfAnbieter, verfuegbareKlassifizierer, setSetting, type SettingKey } from '@/lib/settings';
import { hatRolle } from '@/lib/auth';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await erfordereRolle(req, 'lesen');
  if (!auth.ok) return auth.response;
  // Die letzten 4 Zeichen der KI-Schlüssel sehen nur Admins; alle anderen bekommen nur „gesetzt“ ja/nein
  return NextResponse.json(ladeEinstellungen(hatRolle(auth.benutzer.rolle, 'admin')));
}

const urlOderLeer = z.union([z.literal(''), z.string().trim().url('Muss eine gültige URL sein').max(1000)]);

const bodySchema = z.object({
  senderName: z.string().trim().max(200),
  signature: z.string().max(5000),
  globalDailyLimit: z.coerce.number().int().min(1).max(2000),
  rampeAktiv: z.boolean(),
  rampeStart: z.coerce.number().int().min(1).max(2000),
  rampeSchritt: z.coerce.number().int().min(0).max(500),
  rampeBeginn: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT')]),
  bounceSchwellePostfach: z.coerce.number().int().min(1).max(100),
  impressumUrl: urlOderLeer,
  // Prozessia-Schreibregeln prüfen; fehlt das Feld, bleibt die Einstellung unverändert
  schreibregelnAktiv: z.boolean().optional(),
  datenschutzUrl: urlOderLeer,
  // Nur mit KI-Schlüssel (Anthropic oder OpenRouter) sichtbar; fehlt das Feld, bleibt die Einstellung unverändert
  kiAutoStatus: z.enum(KI_AUTO_STATUS).optional(),
  kiKlassifizierer: z.enum(KI_KLASSIFIZIERER).optional(),
  kiEntwurfAnbieter: z.enum(KI_ENTWURF_ANBIETER).optional(),
  // Modell-IDs (leer = Standard); fehlt das Feld, bleibt die Einstellung unverändert
  openaiModell: z.string().trim().max(200).regex(/^[^\s]*$/, 'Die Modell-ID darf keine Leerzeichen enthalten').optional(),
  jevModell: z.string().trim().max(200).regex(/^[^\s]*$/, 'Die Modell-ID darf keine Leerzeichen enthalten').optional(),
});

function setOrDelete(key: SettingKey, value: string) {
  if (value) setSetting(key, value);
  else deleteSetting(key);
}

export async function PUT(req: Request) {
  const auth = await erfordereRolle(req, 'admin');
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const d = parsed.data;
  if (d.kiEntwurfAnbieter && !verfuegbareEntwurfAnbieter().includes(d.kiEntwurfAnbieter)) {
    return NextResponse.json({ ok: false, error: `Für ${d.kiEntwurfAnbieter === 'openai' ? 'OpenAI' : 'Anthropic'} ist kein API-Schlüssel gesetzt.` }, { status: 400 });
  }
  if (d.kiKlassifizierer && !verfuegbareKlassifizierer().includes(d.kiKlassifizierer)) {
    return NextResponse.json({ ok: false, error: `Für ${d.kiKlassifizierer === 'jev' ? 'Jev' : 'Anthropic'} ist kein API-Schlüssel gesetzt.` }, { status: 400 });
  }
  setOrDelete('sender_name', d.senderName);
  setOrDelete('signature', d.signature.replace(/\r\n?/g, '\n').trim());
  setSetting('global_daily_limit', String(d.globalDailyLimit));
  setSetting('rampe_aktiv', d.rampeAktiv ? '1' : '0');
  setSetting('rampe_start', String(d.rampeStart));
  setSetting('rampe_schritt', String(d.rampeSchritt));
  setOrDelete('rampe_beginn', d.rampeBeginn);
  setSetting('bounce_schwelle_postfach', String(d.bounceSchwellePostfach));
  setOrDelete('impressum_url', d.impressumUrl);
  setOrDelete('datenschutz_url', d.datenschutzUrl);
  if (d.schreibregelnAktiv !== undefined) setSetting('schreibregeln_aktiv', d.schreibregelnAktiv ? '1' : '0');
  if (d.kiAutoStatus) setSetting('ki_auto_status', d.kiAutoStatus);
  if (d.kiKlassifizierer) setSetting('ki_klassifizierer', d.kiKlassifizierer);
  if (d.kiEntwurfAnbieter) setSetting('ki_entwurf_anbieter', d.kiEntwurfAnbieter);
  if (d.openaiModell !== undefined) setOrDelete('openai_model', d.openaiModell);
  if (d.jevModell !== undefined) setOrDelete('jev_modell', d.jevModell);
  return NextResponse.json({ ok: true });
}
