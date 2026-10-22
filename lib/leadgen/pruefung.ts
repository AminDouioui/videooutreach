import { eq, sql } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { bestaetigeMatch, lehneMatchAb } from './resolve/resolve';

// Manuelle Prüfung unsicherer Entity-Resolution-Paare (siehe resolve.ts): zwei Firmen, die dieselbe sein könnten

type FirmaKurz = { id: number; name: string; rechtsform: string | null; strasse: string | null; plz: string | null; ort: string | null; domain: string | null; registerKey: string | null; quellen: string[] };

export type PruefFall = { id: number; score: number; details: Record<string, number | null>; neu: FirmaKurz; kandidat: FirmaKurz };

function kurz(db: Db, id: number): FirmaKurz | null {
  const c = db.select().from(schema.companies).where(eq(schema.companies.id, id)).get();
  if (!c) return null;
  const quellen = db.select({ q: schema.entityMap.quelle }).from(schema.entityMap).where(sql`${schema.entityMap.entityType} = 'company' and ${schema.entityMap.entityId} = ${id}`).all().map((x) => x.q);
  return { id: c.id, name: c.name, rechtsform: c.rechtsform, strasse: c.strasse, plz: c.plz, ort: c.ort, domain: c.domain, registerKey: c.registerKey, quellen: [...new Set(quellen)] };
}

export function ladePruefFaelle(db: Db = getDb()): PruefFall[] {
  const faelle: PruefFall[] = [];
  for (const r of db.select().from(schema.matchReview).where(eq(schema.matchReview.status, 'offen')).orderBy(sql`${schema.matchReview.score} desc`).all()) {
    const neu = kurz(db, r.companyId);
    const kandidat = kurz(db, r.kandidatId);
    if (neu && kandidat) faelle.push({ id: r.id, score: r.score, details: r.details, neu, kandidat });
  }
  return faelle;
}

export function entscheidePruefFall(id: number, aktion: 'zusammenfuehren' | 'trennen', db: Db = getDb()): void {
  if (aktion === 'zusammenfuehren') bestaetigeMatch(id, db);
  else lehneMatchAb(id, db);
}
