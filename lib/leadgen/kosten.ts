import { eq, sql } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';

// Kosten-Tracking für LLM-, Search- und Verifizierungs-Aufrufe je Lauf (Beträge in Tausendstel-Cent, damit auch winzige
// Einzelkosten ohne Rundungsfehler summierbar sind)

export function protokolliereKosten(k: { runId?: number | null; anbieter: string; art: string; einheiten?: number; kostenMilliCent: number }, db: Db = getDb()): void {
  db.insert(schema.leadgenKosten)
    .values({ runId: k.runId ?? null, anbieter: k.anbieter, art: k.art, einheiten: k.einheiten ?? 1, kostenMilliCent: Math.round(k.kostenMilliCent) })
    .run();
}

/** Summe und Aufschlüsselung der Kosten eines Laufs. */
export function kostenEinesLaufs(runId: number, db: Db = getDb()): { gesamtMilliCent: number; nachAnbieter: Array<{ anbieter: string; art: string; einheiten: number; kostenMilliCent: number }> } {
  const zeilen = db
    .select({
      anbieter: schema.leadgenKosten.anbieter,
      art: schema.leadgenKosten.art,
      einheiten: sql<number>`sum(${schema.leadgenKosten.einheiten})`,
      kostenMilliCent: sql<number>`sum(${schema.leadgenKosten.kostenMilliCent})`,
    })
    .from(schema.leadgenKosten)
    .where(eq(schema.leadgenKosten.runId, runId))
    .groupBy(schema.leadgenKosten.anbieter, schema.leadgenKosten.art)
    .all();
  return { gesamtMilliCent: zeilen.reduce((s, z) => s + z.kostenMilliCent, 0), nachAnbieter: zeilen };
}
