import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, schema } from '@/lib/db';
import { summarize } from '@/lib/import';
import { validiereImport } from '@/lib/import-server';
import { importBodySchema } from '@/lib/import-schema';
import { fehler, parseJson } from '@/lib/request';
import { legeLeadsAn } from '@/lib/lead-anlegen';
import { erfordereRolle } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await erfordereRolle(req, 'mitglied');
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const db = getDb();
  const kampagne = db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!kampagne) return fehler('Kampagne nicht gefunden', 404);

  const parsed = await parseJson(req, importBodySchema);
  if ('response' in parsed) return parsed.response;

  // Serverseitig erneut validieren; importiert werden nur gültige Zeilen
  const validiert = await validiereImport(id, parsed.data);

  const importiert = legeLeadsAn(id, validiert).size;

  return NextResponse.json({ imported: importiert, summary: summarize(validiert) });
}
