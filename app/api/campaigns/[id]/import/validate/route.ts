import { NextResponse } from 'next/server';
import { ladeImportKontext } from '@/lib/campaigns';
import { getDb, schema } from '@/lib/db';
import { summarize, validateRows, countByStatus } from '@/lib/import';
import { importBodySchema } from '@/lib/import-schema';
import { fehler, parseJson } from '@/lib/request';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const kampagne = getDb().select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!kampagne) return fehler('Kampagne nicht gefunden', 404);

  const parsed = await parseJson(req, importBodySchema);
  if ('response' in parsed) return parsed.response;

  const rows = validateRows(parsed.data.rows, parsed.data.mapping, { ...ladeImportKontext(id), einProFirma: parsed.data.einProFirma });
  return NextResponse.json({ rows, counts: countByStatus(rows), summary: summarize(rows) });
}
