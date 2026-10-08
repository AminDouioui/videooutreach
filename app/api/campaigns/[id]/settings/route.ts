import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, schema } from '@/lib/db';
import { fehler, parseJson } from '@/lib/request';
import { parseHHMM } from '@/lib/time';

export const runtime = 'nodejs';

const hhmm = z.string().refine((s) => !Number.isNaN(parseHHMM(s)), 'Uhrzeit im Format HH:MM');

const bodySchema = z
  .object({
    name: z.string().trim().min(1, 'Name fehlt').max(200),
    ctaUrl: z.string().trim().url('Termin-Link muss eine gültige URL sein').max(1000),
    dailySendLimit: z.coerce.number().int().min(1).max(500),
    sendWindowStart: hhmm,
    sendWindowEnd: hhmm,
    sendWeekdaysOnly: z.boolean(),
    trackingPixel: z.boolean(),
  })
  .refine((v) => parseHHMM(v.sendWindowStart) < parseHHMM(v.sendWindowEnd), { message: 'Fensterbeginn muss vor dem Fensterende liegen', path: ['sendWindowEnd'] });

/** Kampagnen-Einstellungen speichern (Name, Termin-Link, Limit, Fenster, Pixel) */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const res = getDb().update(schema.campaigns).set(parsed.data).where(eq(schema.campaigns.id, id)).run();
  if (res.changes === 0) return fehler('Kampagne nicht gefunden', 404);
  return NextResponse.json({ ok: true });
}
