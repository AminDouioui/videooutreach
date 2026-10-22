import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema, type Db } from '@/lib/db';
import { STANDARD_ICP, type IcpKonfig } from './config';
import { BRANCHEN } from './extract/schemas';
import { kostenEinesLaufs } from './kosten';
import { legeLaufAn, reiheJobEin } from './queue';

// Ein Lauf = ein Filter des Nutzers, abgearbeitet als Kette von Stufen-Jobs je Firma (siehe stufen.ts, Reihenfolge in STUFEN_REIHENFOLGE).

export const LaufFilterSchema = z.object({
  branchen: z.array(z.enum(BRANCHEN)).default([]),
  mitarbeiterMin: z.number().int().min(0).default(100),
  mitarbeiterMax: z.number().int().min(1).default(800),
  bundeslaender: z.array(z.string().max(60)).max(16).default([]),
  plzPraefixe: z.array(z.string().regex(/^\d{1,5}$/)).max(50).default([]),
  rechtsformen: z.array(z.string().max(60)).max(30).default([]),
  zielRolle: z.string().max(60).default('einkauf_leitung'),
  mindestScore: z.number().int().min(0).max(100).default(0),
  nurVerifizierteEmail: z.boolean().default(true),
  maxFirmen: z.number().int().min(1).max(2000).default(200),
  // Aktualisierungslauf (Re-Crawl, Re-Verifizierung) statt Neusuche: die Firmen stehen schon fest, es gibt keine Auswahl-Stufe
  refresh: z.boolean().optional(),
});
export type LaufFilter = z.infer<typeof LaufFilterSchema>;

/** Stufen eines Laufs in Anzeige- und Ausführungsreihenfolge; `ebene` run = ein Job je Lauf, firma = ein Job je Firma. */
export const STUFEN_REIHENFOLGE = [
  { stufe: 'ingestion', label: 'Ingestion (Rohdaten)', ebene: 'run' },
  { stufe: 'normalisierung', label: 'Normalisierung', ebene: 'run' },
  { stufe: 'resolution', label: 'Entity Resolution', ebene: 'run' },
  { stufe: 'domain', label: 'Domain-Ermittlung', ebene: 'firma' },
  { stufe: 'crawl', label: 'Crawling', ebene: 'firma' },
  { stufe: 'extraktion', label: 'Extraktion', ebene: 'firma' },
  { stufe: 'kontakt', label: 'Kontakt-Engine', ebene: 'firma' },
  { stufe: 'golden', label: 'Golden Record', ebene: 'firma' },
  { stufe: 'scoring', label: 'Scoring', ebene: 'firma' },
] as const;

/** ICP-Konfiguration aus dem Filter: gewählte Branchen bekommen die volle Passung, alle anderen die Standardpassung abzüglich Auswahl. */
export function icpAusFilter(f: LaufFilter): IcpKonfig {
  const branchen: Record<string, number> = { ...STANDARD_ICP.branchen };
  if (f.branchen.length) for (const b of BRANCHEN) branchen[b] = f.branchen.includes(b) ? 1 : 0;
  const rechtsformen = f.rechtsformen.length ? Object.fromEntries(Object.keys(STANDARD_ICP.rechtsformen).map((k) => [k, f.rechtsformen.includes(k) ? 1 : 0])) : STANDARD_ICP.rechtsformen;
  return { ...STANDARD_ICP, branchen, rechtsformen, rechtsformStandard: f.rechtsformen.length ? 0 : STANDARD_ICP.rechtsformStandard, mitarbeiterMin: f.mitarbeiterMin, mitarbeiterMax: f.mitarbeiterMax, bundeslaender: f.bundeslaender, plzPraefixe: f.plzPraefixe };
}

/** Namensbestandteile, an denen sich eine Firma ohne bekannte Branche der Zielgruppe zuordnen lässt (nur für die Vorauswahl) */
export const BRANCHEN_STICHWORTE: Record<(typeof BRANCHEN)[number], string[]> = {
  werkzeugbau: ['werkzeug', 'vorrichtung', 'stanz', 'schneid', 'umform'],
  formenbau: ['formen', 'spritzguss', 'druckguss', 'modellbau'],
  maschinenbau: ['maschin', 'anlagen', 'apparate'],
  sonstige_fertigung: ['fertigung', 'technik', 'metall', 'dreh', 'fräs', 'frae', 'präzision', 'praezision'],
  keine_fertigung: [],
};

/** Gelöschte oder aufgelöste Firmen laut Registerstatus kommen nicht in Frage */
const INAKTIV = ['%removed%', '%dissolved%', '%gelöscht%', '%geloescht%', '%aufgelöst%', '%aufgeloest%', '%liquidat%'];

/**
 * Wählt die Firmen für den Lauf aus dem aufgelösten Bestand. Region, Rechtsform und (bekannte) Mitarbeiterzahl filtern hart;
 * die Branche filtert hart, wenn sie bekannt ist, und lässt sonst Firmen mit passendem Namensbestandteil durch (die Extraktion
 * klassifiziert sie später). Bekannte Treffer stehen vorn, höchstens `maxFirmen`.
 */
export function waehleFirmen(f: LaufFilter, db: Db = getDb()): number[] {
  const bedingungen = [sql`not exists (select 1 from attribute_observations o where o.entity_type = 'company' and o.entity_id = c.id and o.feld = 'status' and (${sql.join(INAKTIV.map((m) => sql`lower(o.wert) like ${m}`), sql` or `)}))`];
  if (f.bundeslaender.length || f.plzPraefixe.length) {
    const teile = [
      ...(f.bundeslaender.length ? [sql`c.bundesland in (${sql.join(f.bundeslaender.map((b) => sql`${b}`), sql`, `)})`] : []),
      ...f.plzPraefixe.map((p) => sql`c.plz like ${p + '%'}`),
    ];
    bedingungen.push(sql`(${sql.join(teile, sql` or `)})`);
  }
  if (f.rechtsformen.length) bedingungen.push(sql`c.rechtsform in (${sql.join(f.rechtsformen.map((r) => sql`${r}`), sql`, `)})`);
  bedingungen.push(sql`(c.mitarbeiter_zahl is null or c.mitarbeiter_zahl between ${Math.floor(f.mitarbeiterMin * 0.7)} and ${Math.ceil(f.mitarbeiterMax * 1.3)})`);
  if (f.branchen.length) {
    const stichworte = f.branchen.flatMap((b) => BRANCHEN_STICHWORTE[b]);
    const namensTeile = stichworte.map((s) => sql`lower(c.name) like ${'%' + s + '%'}`);
    bedingungen.push(
      sql`(c.branche in (${sql.join(f.branchen.map((b) => sql`${b}`), sql`, `)}) or (c.branche is null${namensTeile.length ? sql` and (${sql.join(namensTeile, sql` or `)})` : sql` and 0`}))`,
    );
  }
  const where = sql.join(bedingungen, sql` and `);
  const zeilen = db.all<{ id: number }>(sql`select c.id as id from companies c where ${where} order by (c.branche is not null) desc, c.id limit ${f.maxFirmen}`);
  return zeilen.map((z) => z.id);
}

/** Legt den Lauf an und reiht die erste Stufe ein; die weiteren Stufen reiht jeweils die vorherige nach Erfolg ein. */
export function starteLauf(filter: LaufFilter, db: Db = getDb()): number {
  const runId = legeLaufAn(filter as unknown as Record<string, unknown>, db);
  reiheJobEin(runId, 'ingestion', 0, db);
  return runId;
}

/** Setzt den Lauf auf „fertig“, wenn kein Job mehr offen ist oder läuft. */
export function pruefeLaufAbschluss(runId: number, db: Db = getDb()): boolean {
  const offen = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.pipelineJobs)
    .where(and(eq(schema.pipelineJobs.runId, runId), inArray(schema.pipelineJobs.status, ['offen', 'laeuft'])))
    .get();
  if ((offen?.n ?? 0) > 0) return false;
  // Ist ein Job auf Lauf-Ebene (Ingestion, Normalisierung, Resolution) endgültig fehlgeschlagen, ist der Lauf gescheitert; einzelne
  // fehlgeschlagene Firmen-Jobs lassen ihn „fertig“ werden, bleiben aber in der Fehlerliste sichtbar.
  const laufFehler = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.pipelineJobs)
    .where(and(eq(schema.pipelineJobs.runId, runId), eq(schema.pipelineJobs.status, 'fehler'), eq(schema.pipelineJobs.entityId, 0)))
    .get();
  db.update(schema.pipelineRuns)
    .set({ status: (laufFehler?.n ?? 0) > 0 ? 'fehler' : 'fertig', beendetAm: new Date() })
    .where(and(eq(schema.pipelineRuns.id, runId), eq(schema.pipelineRuns.status, 'laeuft')))
    .run();
  return true;
}

export type LaufStatus = {
  id: number;
  status: string;
  filter: LaufFilter;
  gestartetAm: number;
  beendetAm: number | null;
  firmen: number;
  stufen: Array<{ stufe: string; label: string; ebene: string; offen: number; laeuft: number; fertig: number; fehler: number }>;
  fehlerhafteJobs: Array<{ id: number; stufe: string; firma: string | null; versuche: number; fehler: string | null }>;
  kostenMilliCent: number;
  kosten: Array<{ anbieter: string; art: string; einheiten: number; kostenMilliCent: number }>;
};

/** Fortschritt je Stufe, fehlgeschlagene Jobs und Kosten eines Laufs (für die Oberfläche). */
export function ladeLaufStatus(runId: number, db: Db = getDb()): LaufStatus | null {
  const run = db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.id, runId)).get();
  if (!run) return null;
  const zaehler = db
    .select({ stufe: schema.pipelineJobs.stufe, status: schema.pipelineJobs.status, n: sql<number>`count(*)` })
    .from(schema.pipelineJobs)
    .where(eq(schema.pipelineJobs.runId, runId))
    .groupBy(schema.pipelineJobs.stufe, schema.pipelineJobs.status)
    .all();
  const stufen = STUFEN_REIHENFOLGE.map((s) => {
    const n = (status: string) => zaehler.find((z) => z.stufe === s.stufe && z.status === status)?.n ?? 0;
    return { stufe: s.stufe, label: s.label, ebene: s.ebene, offen: n('offen'), laeuft: n('laeuft'), fertig: n('fertig'), fehler: n('fehler') };
  });
  const fehlerhaft = db
    .select({ id: schema.pipelineJobs.id, stufe: schema.pipelineJobs.stufe, entityId: schema.pipelineJobs.entityId, versuche: schema.pipelineJobs.versuche, fehler: schema.pipelineJobs.fehler, firma: schema.companies.name })
    .from(schema.pipelineJobs)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.pipelineJobs.entityId))
    .where(and(eq(schema.pipelineJobs.runId, runId), eq(schema.pipelineJobs.status, 'fehler')))
    .all();
  const k = kostenEinesLaufs(runId, db);
  const firmen = db.select({ n: sql<number>`count(*)` }).from(schema.lauffirmen).where(eq(schema.lauffirmen.runId, runId)).get()?.n ?? 0;
  return {
    id: run.id,
    status: run.status,
    filter: LaufFilterSchema.parse(run.filter),
    gestartetAm: run.gestartetAm.getTime(),
    beendetAm: run.beendetAm?.getTime() ?? null,
    firmen,
    stufen,
    fehlerhafteJobs: fehlerhaft.map((j) => ({ id: j.id, stufe: j.stufe, firma: j.firma, versuche: j.versuche, fehler: j.fehler })),
    kostenMilliCent: k.gesamtMilliCent,
    kosten: k.nachAnbieter,
  };
}

/** Fehlgeschlagenen Job erneut einreihen (sichtbar gewordene Fehler lassen sich so von Hand wiederholen). */
export function wiederholeJob(jobId: number, db: Db = getDb()): boolean {
  const r = db.update(schema.pipelineJobs).set({ status: 'offen', versuche: 0, naechsterVersuchAt: null, fehler: null, updatedAt: new Date() }).where(and(eq(schema.pipelineJobs.id, jobId), eq(schema.pipelineJobs.status, 'fehler'))).run();
  if (r.changes === 0) return false;
  const j = db.select({ runId: schema.pipelineJobs.runId }).from(schema.pipelineJobs).where(eq(schema.pipelineJobs.id, jobId)).get();
  if (j) db.update(schema.pipelineRuns).set({ status: 'laeuft', beendetAm: null }).where(eq(schema.pipelineRuns.id, j.runId)).run();
  return true;
}
