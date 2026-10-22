import { createHash } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { personenSchluessel } from './resolve/match';
import type { NormalisierterSatz, NormalisiertePerson } from './types';

// Change Detection: Geschäftsführerwechsel und Neueintragungen aus dem Register als Ereignis speichern und als Outreach-Trigger anzeigen.

export type EreignisTyp = (typeof schema.registerEreignisse.$inferInsert)['typ'];
export type EreignisDaten = { firma?: string; registerKey?: string | null; neu?: Array<{ name: string; rolle: string }>; alt?: Array<{ name: string; rolle: string }>; datum?: string | null; hinweis?: string };

const ENTSCHEIDER = new Set(['geschaeftsfuehrer', 'vorstand', 'inhaber']);

const anzeigeName = (p: Pick<NormalisiertePerson, 'vorname' | 'nachname'>) => [p.vorname, p.nachname].filter(Boolean).join(' ');

/**
 * Vergleicht zwei Stände derselben Registerfirma: wer ist als Geschäftsführer/Vorstand/Inhaber neu, wer weg?
 * Wechsel = beides. Reine Funktion, keine Datenbank.
 */
export function vergleicheRegisterSaetze(alt: NormalisierterSatz, neu: NormalisierterSatz): Array<{ typ: EreignisTyp; daten: EreignisDaten }> {
  const entscheider = (s: NormalisierterSatz) => new Map(s.personen.filter((p) => ENTSCHEIDER.has(p.rolle)).map((p) => [personenSchluessel(p), p]));
  const a = entscheider(alt);
  const n = entscheider(neu);
  const dazu = [...n.entries()].filter(([k]) => !a.has(k)).map(([, p]) => ({ name: anzeigeName(p), rolle: p.rolleOriginal ?? p.rolle }));
  const weg = [...a.entries()].filter(([k]) => !n.has(k)).map(([, p]) => ({ name: anzeigeName(p), rolle: p.rolleOriginal ?? p.rolle }));
  const basis = { firma: neu.name, registerKey: null };
  if (dazu.length && weg.length) return [{ typ: 'gf_wechsel', daten: { ...basis, neu: dazu, alt: weg } }];
  if (dazu.length) return [{ typ: 'gf_neu', daten: { ...basis, neu: dazu } }];
  if (weg.length) return [{ typ: 'gf_ausgeschieden', daten: { ...basis, alt: weg } }];
  return [];
}

const schluessel = (quelle: string, referenz: string, typ: string, daten: EreignisDaten) =>
  createHash('sha256').update(JSON.stringify([quelle, referenz, typ, daten.neu ?? [], daten.alt ?? [], daten.datum ?? ''])).digest('hex');

/** Speichert ein Ereignis (dasselbe Ereignis aus derselben Quelle nur einmal). true = neu gespeichert. */
export function speichereEreignis(e: { quelle: string; referenz: string; typ: EreignisTyp; daten: EreignisDaten; companyId?: number | null }, db: Db = getDb()): boolean {
  const res = db
    .insert(schema.registerEreignisse)
    .values({ quelle: e.quelle, referenz: e.referenz, companyId: e.companyId ?? null, typ: e.typ, daten: e.daten as Record<string, unknown>, schluessel: schluessel(e.quelle, e.referenz, e.typ, e.daten) })
    .onConflictDoNothing()
    .run();
  return res.changes > 0;
}

/** Trägt company_id bei Ereignissen nach, sobald die Entity Resolution die Quelle einer Firma zugeordnet hat. */
export function verknuepfeEreignisse(db: Db = getDb()): number {
  return db.run(
    sql`update register_events set company_id = (select m.entity_id from entity_map m where m.entity_type = 'company' and m.quelle = register_events.quelle and m.referenz = register_events.referenz limit 1) where company_id is null and exists (select 1 from entity_map m where m.entity_type = 'company' and m.quelle = register_events.quelle and m.referenz = register_events.referenz)`,
  ).changes;
}

export type EreignisZeile = { id: number; typ: EreignisTyp; status: string; erkanntAm: number; companyId: number | null; firma: string; daten: EreignisDaten };

/** Offene Ereignisse (neueste zuerst) mit Firmenname, für die Anzeige als Outreach-Trigger. */
export function ladeEreignisse(opt: { nurNeue?: boolean; limit?: number } = {}, db: Db = getDb()): EreignisZeile[] {
  verknuepfeEreignisse(db);
  const rows = db
    .select({ e: schema.registerEreignisse, name: schema.companies.name, form: schema.companies.rechtsform })
    .from(schema.registerEreignisse)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.registerEreignisse.companyId))
    .where(opt.nurNeue ? eq(schema.registerEreignisse.status, 'neu') : undefined)
    .orderBy(desc(schema.registerEreignisse.erkanntAm), desc(schema.registerEreignisse.id))
    .limit(opt.limit ?? 50)
    .all();
  return rows.map(({ e, name, form }) => ({ id: e.id, typ: e.typ, status: e.status, erkanntAm: e.erkanntAm.getTime(), companyId: e.companyId, firma: name ? (form ? `${name} ${form}` : name) : ((e.daten as EreignisDaten).firma ?? e.referenz), daten: e.daten as EreignisDaten }));
}

export function markiereEreignis(id: number, status: 'gesehen' | 'angereichert', db: Db = getDb()): boolean {
  return db.update(schema.registerEreignisse).set({ status, bearbeitetAm: new Date() }).where(and(eq(schema.registerEreignisse.id, id))).run().changes > 0;
}

export const EREIGNIS_LABEL: Record<EreignisTyp, string> = {
  neueintragung: 'Neueintragung im Handelsregister',
  gf_neu: 'Neuer Geschäftsführer',
  gf_ausgeschieden: 'Geschäftsführer ausgeschieden',
  gf_wechsel: 'Geschäftsführerwechsel',
};
