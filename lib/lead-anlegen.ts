import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import type { ValidatedRow } from './import';
import { createSlug } from './slug';

/** Legt die gültigen Zeilen (status 'ok') einer Import-Prüfung als Leads an; liefert die ID je Zeilen-Index. */
export function legeLeadsAn(campaignId: number, zeilen: ValidatedRow[]): Map<number, number> {
  const db = getDb();
  const gueltig = zeilen.filter((r) => r.status === 'ok');
  return db.transaction((tx) => {
    const ids = new Map<number, number>();
    const vergeben = new Set<string>();
    const slugExists = (s: string) => vergeben.has(s) || !!tx.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.slug, s)).get();
    for (const { index, lead } of gueltig) {
      const slug = createSlug(lead.firma, slugExists);
      vergeben.add(slug);
      const neu = tx
        .insert(schema.leads)
        .values({
          campaignId,
          firma: lead.firma,
          anrede: lead.anrede || null,
          vorname: lead.vorname || null,
          nachname: lead.nachname || null,
          email: lead.email,
          position: lead.position || null,
          website: lead.website || null,
          zeitzone: lead.zeitzone || null,
          extra: Object.keys(lead.extra).length ? lead.extra : null,
          slug,
        })
        .returning({ id: schema.leads.id })
        .get();
      ids.set(index, neu.id);
    }
    return ids;
  });
}
