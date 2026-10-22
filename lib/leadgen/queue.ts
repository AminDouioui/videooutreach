import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';

// Pipeline-Jobs in der DB (gleiches Muster wie die Webhook-Zustellung): ein Job je Lauf, Stufe und Entität, idempotent angelegt,
// atomar übernommen, bei Fehlern mit Backoff wiederholt und danach sichtbar als 'fehler' markiert.

type Stufe = (typeof schema.pipelineJobs.$inferInsert)['stufe'];
export type PipelineJob = typeof schema.pipelineJobs.$inferSelect;

/** Wartezeit bis zum nächsten Versuch nach dem n-ten Fehlversuch: 1 min, 5 min, 30 min, 2 h; danach aufgeben. */
export const LEADGEN_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000] as const;

export function leadgenBackoffMs(versuche: number): number | null {
  if (versuche < 1) return LEADGEN_BACKOFF_MS[0];
  return LEADGEN_BACKOFF_MS[versuche - 1] ?? null;
}

export function legeLaufAn(filter: Record<string, unknown>, db: Db = getDb()): number {
  return db.insert(schema.pipelineRuns).values({ filter }).returning({ id: schema.pipelineRuns.id }).get().id;
}

/** Legt den Job an, falls es ihn für Lauf, Stufe und Entität noch nicht gibt. true = neu angelegt. */
export function reiheJobEin(runId: number, stufe: Stufe, entityId = 0, db: Db = getDb()): boolean {
  const res = db.insert(schema.pipelineJobs).values({ runId, stufe, entityId }).onConflictDoNothing().run();
  return res.changes > 0;
}

/** Nimmt den ältesten fälligen Job (optional einer Stufe) und setzt ihn atomar auf 'laeuft'; null = nichts zu tun. */
export function holeFaelligenJob(stufe?: Stufe, jetzt = Date.now(), db: Db = getDb()): PipelineJob | null {
  return db.transaction((tx) => {
    const bedingung = and(
      eq(schema.pipelineJobs.status, 'offen'),
      or(isNull(schema.pipelineJobs.naechsterVersuchAt), lte(schema.pipelineJobs.naechsterVersuchAt, new Date(jetzt))),
      stufe ? eq(schema.pipelineJobs.stufe, stufe) : undefined,
    );
    const job = tx.select().from(schema.pipelineJobs).where(bedingung).orderBy(schema.pipelineJobs.id).limit(1).get();
    if (!job) return null;
    const res = tx
      .update(schema.pipelineJobs)
      .set({ status: 'laeuft', updatedAt: new Date(jetzt) })
      .where(and(eq(schema.pipelineJobs.id, job.id), eq(schema.pipelineJobs.status, 'offen')))
      .run();
    return res.changes === 1 ? { ...job, status: 'laeuft' as const } : null;
  });
}

export function schliesseJobAb(id: number, jetzt = Date.now(), db: Db = getDb()): void {
  db.update(schema.pipelineJobs).set({ status: 'fertig', fehler: null, updatedAt: new Date(jetzt) }).where(eq(schema.pipelineJobs.id, id)).run();
}

/** Fehlversuch: Backoff und erneut einreihen, nach dem letzten Versuch Status 'fehler' (bleibt sichtbar). */
export function meldeJobFehler(id: number, meldung: string, jetzt = Date.now(), db: Db = getDb()): 'wiederholt' | 'aufgegeben' {
  return db.transaction((tx) => {
    const job = tx.select().from(schema.pipelineJobs).where(eq(schema.pipelineJobs.id, id)).get();
    if (!job) return 'aufgegeben';
    const versuche = job.versuche + 1;
    const warten = leadgenBackoffMs(versuche);
    tx.update(schema.pipelineJobs)
      .set({ versuche, fehler: meldung.slice(0, 500), status: warten === null ? 'fehler' : 'offen', naechsterVersuchAt: warten === null ? null : new Date(jetzt + warten), updatedAt: new Date(jetzt) })
      .where(eq(schema.pipelineJobs.id, id))
      .run();
    return warten === null ? 'aufgegeben' : 'wiederholt';
  });
}

/** Beim Worker-Start: Jobs, die beim letzten Beenden mitten in der Arbeit hingen, wieder freigeben. */
export function gibHaengendeJobsFrei(aelterAlsMs = 15 * 60_000, jetzt = Date.now(), db: Db = getDb()): number {
  return db
    .update(schema.pipelineJobs)
    .set({ status: 'offen', updatedAt: new Date(jetzt) })
    .where(and(eq(schema.pipelineJobs.status, 'laeuft'), lte(schema.pipelineJobs.updatedAt, new Date(jetzt - aelterAlsMs))))
    .run().changes;
}

/** Anzahl Jobs je Stufe und Status eines Laufs (für die Fortschrittsanzeige). */
export function jobZaehler(runId: number, db: Db = getDb()): Array<{ stufe: string; status: string; n: number }> {
  return db
    .select({ stufe: schema.pipelineJobs.stufe, status: schema.pipelineJobs.status, n: sql<number>`count(*)` })
    .from(schema.pipelineJobs)
    .where(eq(schema.pipelineJobs.runId, runId))
    .groupBy(schema.pipelineJobs.stufe, schema.pipelineJobs.status)
    .all();
}
