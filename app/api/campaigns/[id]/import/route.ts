import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { ladeImportKontext } from '@/lib/campaigns';
import { getDb, schema } from '@/lib/db';
import { summarize, validateRows } from '@/lib/import';
import { importBodySchema } from '@/lib/import-schema';
import { fehler, parseJson } from '@/lib/request';
import { createSlug } from '@/lib/slug';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fehler('Ungültige Kampagne', 404);
  const db = getDb();
  const kampagne = db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!kampagne) return fehler('Kampagne nicht gefunden', 404);

  const parsed = await parseJson(req, importBodySchema);
  if ('response' in parsed) return parsed.response;

  // Serverseitig erneut validieren; importiert werden nur gültige Zeilen
  const validiert = validateRows(parsed.data.rows, parsed.data.mapping, { ...ladeImportKontext(id), einProFirma: parsed.data.einProFirma });
  const gueltig = validiert.filter((r) => r.status === 'ok');

  const importiert = db.transaction((tx) => {
    const vergeben = new Set<string>();
    const slugExists = (s: string) => vergeben.has(s) || !!tx.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.slug, s)).get();
    for (const { lead } of gueltig) {
      const slug = createSlug(lead.firma, slugExists);
      vergeben.add(slug);
      tx.insert(schema.leads)
        .values({
          campaignId: id,
          firma: lead.firma,
          anrede: lead.anrede || null,
          vorname: lead.vorname || null,
          nachname: lead.nachname || null,
          email: lead.email,
          position: lead.position || null,
          website: lead.website || null,
          extra: Object.keys(lead.extra).length ? lead.extra : null,
          slug,
        })
        .run();
    }
    return gueltig.length;
  });

  return NextResponse.json({ imported: importiert, summary: summarize(validiert) });
}
