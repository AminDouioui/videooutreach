import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hebeFirmenDuplikateAuf, schliesseFirmenDuplikateAus } from '@/lib/campaigns';
import { getDb, schema } from '@/lib/db';
import { fehler, parseJson } from '@/lib/request';

export const runtime = 'nodejs';

const bodySchema = z.object({ action: z.enum(['ausschliessen', 'aufheben']) });

/** Weitere Kontakte derselben Firma vom Versand ausschließen bzw. den Ausschluss aufheben */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const k = getDb().select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) return fehler('Kampagne nicht gefunden', 404);
  const parsed = await parseJson(req, bodySchema);
  if ('response' in parsed) return parsed.response;
  const anzahl = parsed.data.action === 'ausschliessen' ? schliesseFirmenDuplikateAus(id) : hebeFirmenDuplikateAuf(id);
  return NextResponse.json({ ok: true, anzahl });
}
