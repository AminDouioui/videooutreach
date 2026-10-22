import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { getSetting, setSetting } from '@/lib/settings';
import { berechneAlleGolden } from './golden/rebuild';
import { LaufFilterSchema } from './lauf';
import { legeLaufAn, reiheJobEin } from './queue';

// Stufe 10: Aktualisierung. Re-Crawl- und Re-Verifizierungs-Intervalle je Datentyp, „Rolle offen“ erneut versuchen, Golden Record täglich
// neu berechnen (damit der Decay alte Daten abwertet). Aufgefrischt werden nur Firmen, die in einer Kampagne stehen, und offene Rollen,
// höchstens `max` je Planung, damit Kosten und Last begrenzt bleiben.

export type Intervalle = { emailStatusTage: number; webTage: number; maxProPlanung: number };
export const STANDARD_INTERVALLE: Intervalle = { emailStatusTage: 30, webTage: 90, maxProPlanung: 100 };

const TAG_MS = 86_400_000;

export function ladeIntervalle(): Intervalle {
  try {
    const roh = getSetting('leadgen_intervalle');
    const j = roh ? (JSON.parse(roh) as Partial<Intervalle>) : {};
    const pos = (x: unknown, std: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 1 ? Math.floor(x) : std);
    return { emailStatusTage: pos(j.emailStatusTage, STANDARD_INTERVALLE.emailStatusTage), webTage: pos(j.webTage, STANDARD_INTERVALLE.webTage), maxProPlanung: pos(j.maxProPlanung, STANDARD_INTERVALLE.maxProPlanung) };
  } catch {
    return STANDARD_INTERVALLE;
  }
}

export type FaelligGrund = 'email' | 'web' | 'rolle_offen';
export type FaelligeFirma = { companyId: number; rolleKey: string; grund: FaelligGrund };

/** Welche Firmen sind für eine Auffrischung fällig? Ein Eintrag je Firma und Rolle, der erste zutreffende Grund zählt. */
export function faelligeFirmen(opt: { db?: Db; jetzt?: number; intervalle?: Intervalle } = {}): FaelligeFirma[] {
  const db = opt.db ?? getDb();
  const jetzt = opt.jetzt ?? Date.now();
  const iv = opt.intervalle ?? ladeIntervalle();
  const aktive = new Set(db.select({ c: schema.leads.leadgenCompanyId }).from(schema.leads).where(isNotNull(schema.leads.leadgenCompanyId)).all().map((l) => l.c as number));
  const aus: FaelligeFirma[] = [];
  const ergebnisse = db.select().from(schema.kontaktErgebnisse).all();
  for (const e of ergebnisse) {
    // Offene Rolle: zum geplanten Zeitpunkt erneut versuchen (auch wenn die Firma noch in keiner Kampagne steht)
    if (e.status === 'rolle_offen') {
      if (e.naechsteAnreicherungAt && e.naechsteAnreicherungAt.getTime() <= jetzt) aus.push({ companyId: e.companyId, rolleKey: e.rolleKey, grund: 'rolle_offen' });
      continue;
    }
    if (!aktive.has(e.companyId) || e.status !== 'gefunden') continue;
    const cp = e.contactPointId ? db.select().from(schema.contactPoints).where(eq(schema.contactPoints.id, e.contactPointId)).get() : undefined;
    const geprueft = cp?.verifiziertAm?.getTime() ?? e.updatedAt.getTime();
    if (jetzt - geprueft >= iv.emailStatusTage * TAG_MS) {
      aus.push({ companyId: e.companyId, rolleKey: e.rolleKey, grund: 'email' });
      continue;
    }
    const letzte = db.select().from(schema.extractionRuns).where(eq(schema.extractionRuns.companyId, e.companyId)).orderBy(desc(schema.extractionRuns.id)).get();
    if (letzte && jetzt - letzte.createdAt.getTime() >= iv.webTage * TAG_MS) aus.push({ companyId: e.companyId, rolleKey: e.rolleKey, grund: 'web' });
  }
  return aus.slice(0, iv.maxProPlanung);
}

/** Startstufe je Grund: Re-Verifizierung braucht nur die Kontakt-Engine, Re-Crawl beginnt beim Crawling, ohne Domain bei der Domain-Ermittlung. */
function startStufe(db: Db, f: FaelligeFirma): 'domain' | 'crawl' | 'kontakt' {
  const hatDomain = !!db.select({ id: schema.domains.id }).from(schema.domains).where(and(eq(schema.domains.companyId, f.companyId), eq(schema.domains.verifiziert, true))).get();
  if (!hatDomain) return 'domain';
  return f.grund === 'email' ? 'kontakt' : 'crawl';
}

/** Legt einen Aktualisierungslauf für feste Firmen an (keine Auswahl-Stufe) und reiht je Firma die Startstufe ein. */
export function starteAuffrischung(firmen: FaelligeFirma[], db: Db = getDb()): number[] {
  const nachRolle = new Map<string, FaelligeFirma[]>();
  for (const f of firmen) nachRolle.set(f.rolleKey, [...(nachRolle.get(f.rolleKey) ?? []), f]);
  const runs: number[] = [];
  for (const [rolleKey, liste] of nachRolle) {
    const filter = LaufFilterSchema.parse({ zielRolle: rolleKey, nurVerifizierteEmail: false, maxFirmen: Math.max(1, liste.length), refresh: true });
    const runId = legeLaufAn(filter as unknown as Record<string, unknown>, db);
    for (const f of liste) {
      db.insert(schema.lauffirmen).values({ runId, companyId: f.companyId }).onConflictDoNothing().run();
      reiheJobEin(runId, startStufe(db, f), f.companyId, db);
    }
    runs.push(runId);
  }
  return runs;
}

function laeuftAuffrischung(db: Db): boolean {
  return db
    .select({ id: schema.pipelineRuns.id, filter: schema.pipelineRuns.filter })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.status, 'laeuft'))
    .all()
    .some((r) => (r.filter as { refresh?: boolean }).refresh === true);
}

/**
 * Wird vom Worker regelmäßig aufgerufen: plant fällige Auffrischungen (höchstens stündlich, nie parallel zu einer laufenden) und
 * berechnet den Golden Record einmal täglich neu (Decay). Mit Einstellung `leadgen_refresh_aktiv = 0` ist nur die Auffrischung aus.
 */
export function zeitplanTick(opt: { db?: Db; jetzt?: number } = {}): { geplant: number; golden: boolean } {
  const db = opt.db ?? getDb();
  const jetzt = opt.jetzt ?? Date.now();
  let geplant = 0;
  let golden = false;
  const zuletzt = (key: 'leadgen_refresh_zuletzt' | 'leadgen_golden_zuletzt') => Number(getSetting(key)) || 0;
  if (getSetting('leadgen_refresh_aktiv') !== '0' && jetzt - zuletzt('leadgen_refresh_zuletzt') >= 3600_000 && !laeuftAuffrischung(db)) {
    setSetting('leadgen_refresh_zuletzt', String(jetzt));
    const f = faelligeFirmen({ db, jetzt });
    if (f.length) {
      starteAuffrischung(f, db);
      geplant = f.length;
    }
  }
  if (jetzt - zuletzt('leadgen_golden_zuletzt') >= TAG_MS) {
    setSetting('leadgen_golden_zuletzt', String(jetzt));
    berechneAlleGolden({ db, jetzt });
    golden = true;
  }
  return { geplant, golden };
}

/** Kontakt für Firmen neu anreichern (z. B. nach einem Geschäftsführerwechsel): Lauf anlegen, Startstufe einreihen. */
export function starteAnreicherungFuerFirma(companyId: number, rolleKey: string, db: Db = getDb()): number {
  return starteAuffrischung([{ companyId, rolleKey, grund: 'web' }], db)[0];
}

