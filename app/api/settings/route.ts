import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ladeEinstellungen } from '@/lib/settings-view';
import { parseJson } from '@/lib/request';
import { deleteSetting, setSetting, type SettingKey } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(ladeEinstellungen());
}

const urlOderLeer = z.union([z.literal(''), z.string().trim().url('Muss eine gültige URL sein').max(1000)]);

const bodySchema = z.object({
  senderName: z.string().trim().max(200),
  signature: z.string().max(5000),
  globalDailyLimit: z.coerce.number().int().min(1).max(2000),
  impressumUrl: urlOderLeer,
  datenschutzUrl: urlOderLeer,
});

function setOrDelete(key: SettingKey, value: string) {
  if (value) setSetting(key, value);
  else deleteSetting(key);
}

export async function PUT(req: Request) {
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const d = parsed.data;
  setOrDelete('sender_name', d.senderName);
  setOrDelete('signature', d.signature.replace(/\r\n?/g, '\n').trim());
  setSetting('global_daily_limit', String(d.globalDailyLimit));
  setOrDelete('impressum_url', d.impressumUrl);
  setOrDelete('datenschutz_url', d.datenschutzUrl);
  return NextResponse.json({ ok: true });
}
