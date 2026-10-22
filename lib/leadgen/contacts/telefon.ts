import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@/lib/db';

// Telefon: Zentrale und Durchwahl aus Impressum und Webseite (Stufe 5). Mobilnummern nur, wenn sie öffentlich auf der Webseite oder im
// Register stehen; Crowd-, Adressbuch- oder zugekaufte Mobildaten gibt es nicht (diese Funktion liest ausschließlich unsere
// Webseiten- und Registerbeobachtungen).

const ERLAUBTE_QUELLEN = new Set(['web', 'handelsregister', 'offeneregister']);

/** Übernimmt die Rufnummern aus den Beobachtungen der Firma (und ihrer Personen) als contact_points; gibt die Zahl neuer/aktualisierter Nummern zurück. */
export function uebernehmeTelefone(companyId: number, db: Db): number {
  const personen = db.select().from(schema.persons).where(eq(schema.persons.companyId, companyId)).all();
  const personIds = new Set(personen.map((p) => p.id));
  const feld = (typ: 'company' | 'person') => and(eq(schema.attributeObservations.feld, 'telefon'), eq(schema.attributeObservations.entityType, typ));
  const beobachtungen = [
    ...db.select().from(schema.attributeObservations).where(and(feld('company'), eq(schema.attributeObservations.entityId, companyId))).all(),
    ...(personIds.size ? db.select().from(schema.attributeObservations).where(and(feld('person'), inArray(schema.attributeObservations.entityId, [...personIds]))).all() : []),
  ].filter((o) => ERLAUBTE_QUELLEN.has(o.quelle));
  let n = 0;
  for (const o of beobachtungen) {
    const w = o.wert as { e164?: string; art?: string; url?: string };
    // Faxnummern sind keine Ansprechnummern
    if (!w.e164 || w.art === 'fax') continue;
    const art = w.art === 'unbekannt' || !w.art ? null : w.art;
    db.insert(schema.contactPoints)
      .values({ companyId, personId: o.entityType === 'person' ? o.entityId : null, typ: 'telefon', wert: w.e164, status: 'oeffentlich', art, konfidenz: o.konfidenz, herkunft: { quelle: o.quelle, url: w.url ?? null, rawDocumentId: o.rawDocumentId } })
      .onConflictDoUpdate({
        target: [schema.contactPoints.companyId, schema.contactPoints.typ, schema.contactPoints.wert],
        // Die Art nur ergänzen, nie eine bekannte Art durch „unbekannt“ ersetzen
        set: { konfidenz: o.konfidenz, ...(art ? { art } : {}), updatedAt: new Date() },
      })
      .run();
    n++;
  }
  return n;
}
