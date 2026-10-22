import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { fuehreKontaktEngineAus } from './contacts/engine';
import type { KontaktDeps } from './contacts/steps';
import { extrahiereFirma } from './extract/run';
import { berechneGolden, ladeGoldenFirma } from './golden/rebuild';
import { icpAusFilter, LaufFilterSchema, pruefeLaufAbschluss, waehleFirmen } from './lauf';
import { holeFaelligenJob, meldeJobFehler, reiheJobEin, schliesseJobAb, type PipelineJob } from './queue';
import { loeseEntitaetenAuf } from './resolve/resolve';
import { berechneDatenScore, berechneIcpScore } from './score';
import { crawleFirma, ermittleDomain } from './web';

// Orchestrierung: jede Stufe ist ein eigener, idempotenter Job. Eine erfolgreiche Stufe reiht die nächste für dieselbe Firma ein
// (Unique-Index auf Lauf, Stufe, Firma: doppeltes Einreihen ist wirkungslos). Wiederholung mit Backoff und Sichtbarkeit fehlgeschlagener
// Jobs übernimmt queue.ts. Stufen 1 und 2 (Ingestion, Normalisierung) laufen beim Import der Quellen; die Lauf-Jobs prüfen den Bestand.

type Stufe = (typeof schema.pipelineJobs.$inferSelect)['stufe'];

function ladeLauf(db: Db, runId: number) {
  const run = db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.id, runId)).get();
  if (!run) throw new Error(`Lauf ${runId} existiert nicht.`);
  return { run, filter: LaufFilterSchema.parse(run.filter) };
}

/** Extraktion nur, wenn es neue Seiten gibt: eine Firma wird bei einem späteren Lauf nicht noch einmal ans LLM geschickt. */
function extraktionNoetig(db: Db, companyId: number): boolean {
  const letzter = db.select().from(schema.extractionRuns).where(eq(schema.extractionRuns.companyId, companyId)).orderBy(desc(schema.extractionRuns.id)).get();
  if (!letzter) return true;
  const neueste = db.all<{ t: number | null }>(sql`select max(r.abgerufen_am) as t from crawl_pages p join raw_documents r on r.id = p.raw_document_id where p.company_id = ${companyId} and p.status = 'ok'`)[0]?.t ?? 0;
  return neueste > letzter.createdAt.getTime();
}

export async function fuehreJobAus(job: PipelineJob, deps: KontaktDeps, db: Db = getDb()): Promise<void> {
  const { run, filter } = ladeLauf(db, job.runId);
  const weiter = (stufe: Stufe, companyId = job.entityId) => reiheJobEin(job.runId, stufe, companyId, db);
  const companyId = job.entityId;

  switch (job.stufe) {
    case 'ingestion': {
      // Der Bestand kommt aus den Importen (OffeneRegister-Datei, später Register-Abrufe). Ohne Rohdaten kann kein Lauf etwas finden.
      const n = db.all<{ n: number }>(sql`select count(*) as n from raw_documents`)[0]?.n ?? 0;
      if (n === 0) throw new Error('Kein Datenbestand: erst Quellen importieren (z. B. npm run leadgen:offeneregister -- datei.jsonl).');
      weiter('normalisierung', 0);
      return;
    }
    case 'normalisierung': {
      const n = db.all<{ n: number }>(sql`select count(*) as n from attribute_observations where feld = 'name'`)[0]?.n ?? 0;
      if (n === 0) throw new Error('Keine normalisierten Firmendaten vorhanden: der Import hat keine verwertbaren Datensätze geliefert.');
      weiter('resolution', 0);
      return;
    }
    case 'resolution': {
      loeseEntitaetenAuf(db);
      const ids = waehleFirmen(filter, db);
      for (const id of ids) {
        db.insert(schema.lauffirmen).values({ runId: run.id, companyId: id }).onConflictDoNothing().run();
        weiter('domain', id);
      }
      return;
    }
    case 'domain': {
      const r = await ermittleDomain(companyId, deps, db);
      // Ohne bestätigte Domain gibt es nichts zu crawlen; die Firma erscheint trotzdem (mit niedrigem Score) im Ergebnis
      weiter(r.status === 'nicht_gefunden' ? 'golden' : 'crawl');
      return;
    }
    case 'crawl': {
      const r = await crawleFirma(companyId, deps, db);
      weiter(r.seiten > 0 ? 'extraktion' : 'kontakt');
      return;
    }
    case 'extraktion': {
      if (extraktionNoetig(db, companyId)) await extrahiereFirma(companyId, deps, db);
      weiter('kontakt');
      return;
    }
    case 'kontakt': {
      const r = await fuehreKontaktEngineAus(companyId, filter.zielRolle, deps, { db });
      // Technischer Fehler ohne Ergebnis: Job schlägt fehl und wird mit Backoff wiederholt
      if (r.status === 'fehler') throw new Error(r.fehler.join('; ') || 'Kontakt-Engine fehlgeschlagen');
      weiter('golden');
      return;
    }
    case 'golden': {
      berechneGolden(companyId, { db, icp: icpAusFilter(filter), zielRolleKey: filter.zielRolle });
      weiter('scoring');
      return;
    }
    case 'scoring': {
      // Scores nach dem Filter dieses Laufs (ICP) festhalten; Gesamt = Mittel aus ICP-Fit und Datenqualität
      const jetzt = Date.now();
      const golden = ladeGoldenFirma(companyId, db, jetzt, filter.zielRolle);
      const icp = berechneIcpScore(golden, icpAusFilter(filter)).score;
      const daten = berechneDatenScore(golden, jetzt).score;
      db.update(schema.lauffirmen).set({ icpScore: icp, datenScore: daten, gesamtScore: Math.round((icp + daten) / 2) }).where(and(eq(schema.lauffirmen.runId, run.id), eq(schema.lauffirmen.companyId, companyId))).run();
      return;
    }
    default:
      throw new Error(`Unbekannte Stufe: ${job.stufe}`);
  }
}

/** Nimmt einen fälligen Job und führt ihn aus; false = nichts zu tun. Fehler werden mit Backoff wiederholt, nie nach oben geworfen. */
export async function verarbeiteNaechstenJob(deps: (runId: number) => KontaktDeps, opt: { db?: Db; jetzt?: number } = {}): Promise<boolean> {
  const db = opt.db ?? getDb();
  const job = holeFaelligenJob(undefined, opt.jetzt ?? Date.now(), db);
  if (!job) return false;
  try {
    await fuehreJobAus(job, deps(job.runId), db);
    schliesseJobAb(job.id, opt.jetzt ?? Date.now(), db);
  } catch (e) {
    meldeJobFehler(job.id, e instanceof Error ? e.message : String(e), opt.jetzt ?? Date.now(), db);
  }
  pruefeLaufAbschluss(job.runId, db);
  return true;
}
