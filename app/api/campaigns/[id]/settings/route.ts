import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, schema } from '@/lib/db';
import { fehler, parseJson } from '@/lib/request';
import { formatSendDays, parseHHMM } from '@/lib/time';

export const runtime = 'nodejs';

const hhmm = z.string().refine((s) => !Number.isNaN(parseHHMM(s)), 'Uhrzeit im Format HH:MM');

const datum = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Ungültiges Datum');

const bodySchema = z
  .object({
    name: z.string().trim().min(1, 'Name fehlt').max(200),
    ctaUrl: z.string().trim().url('Termin-Link muss eine gültige URL sein').max(1000),
    dailySendLimit: z.coerce.number().int().min(1).max(500),
    sendWindowStart: hhmm,
    sendWindowEnd: hhmm,
    sendDays: z.array(z.number().int().min(1).max(7)).min(1, 'Mindestens einen Versandtag wählen'),
    startDatum: z.union([datum, z.literal('')]).nullable(),
    maxNeueLeadsProTag: z.coerce.number().int().min(1).max(500).nullable(),
    trackingPixel: z.boolean(),
    stoppBeiFirmenAntwort: z.boolean(),
  })
  .refine((v) => parseHHMM(v.sendWindowStart) < parseHHMM(v.sendWindowEnd), { message: 'Fensterbeginn muss vor dem Fensterende liegen', path: ['sendWindowEnd'] });

/** Kampagnen-Einstellungen speichern (Name, Termin-Link, Limit, Fenster, Versandtage, Startdatum, Pixel) */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const d = parsed.data;
  const res = getDb()
    .update(schema.campaigns)
    .set({ ...d, sendDays: formatSendDays(d.sendDays), startDatum: d.startDatum || null })
    .where(eq(schema.campaigns.id, id)).run();
  if (res.changes === 0) return fehler('Kampagne nicht gefunden', 404);
  return NextResponse.json({ ok: true });
}
