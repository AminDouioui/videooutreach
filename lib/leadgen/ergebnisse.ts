import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { LaufFilterSchema, type LaufFilter } from './lauf';
import { klassenUeberlappung } from './score';

// Ergebnisliste eines Laufs: Firma, Ansprechpartner, E-Mail und Telefon mit Quelle und Konfidenz je Feld, dazu die Scores.

export type FeldQuelle = { quelle: string; konfidenz: number; typ?: string };

export type ErgebnisZeile = {
  companyId: number;
  firma: string;
  rechtsform: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  bundesland: string | null;
  domain: string | null;
  branche: string | null;
  brancheKonfidenz: number | null;
  mitarbeiter: { zahl: number | null; typ: string | null; klasse: string | null } | null;
  person: { id: number; vorname: string | null; nachname: string; rolle: string | null; rolleText: string | null; rollenTreffer: string | null; quelle: FeldQuelle | null } | null;
  email: { adresse: string; status: string; konfidenz: number; muster: string | null; verifiziertAm: number | null; quellen: string[] } | null;
  telefone: Array<{ wert: string; art: string | null; quelle: string | null }>;
  scores: { icp: number | null; daten: number | null; gesamt: number | null };
  /** Quelle und Konfidenz je Stammdatenfeld (aus dem Golden Record) */
  herkunft: Record<string, FeldQuelle>;
  /** Hinweise für die Anzeige: rolle_fallback, catch_all, generisch, branche_unbekannt, mitarbeiter_unbekannt */
  hinweise: string[];
  /** Schon als Lead in einer Kampagne */
  uebernommen: boolean;
};

export type ErgebnisOptionen = {
  mindestScore?: number;
  nurVerifizierteEmail?: boolean;
  limit?: number;
  offset?: number;
  companyIds?: number[];
};

const slim = (h: unknown): FeldQuelle | null => {
  const o = h as { quelle?: string; konfidenz?: number; typ?: string } | undefined;
  return o && typeof o.quelle === 'string' && typeof o.konfidenz === 'number' ? { quelle: o.quelle, konfidenz: o.konfidenz, typ: o.typ } : null;
};

/** Passt die Firma noch zum Filter? Bekannte Abweichungen schließen aus, Unbekanntes bleibt (der ICP-Score bewertet es niedriger). */
function passtZumFilter(z: ErgebnisZeile, f: LaufFilter): boolean {
  if (f.branchen.length && z.branche && !(f.branchen as string[]).includes(z.branche)) return false;
  if (z.mitarbeiter?.zahl != null && (z.mitarbeiter.zahl < f.mitarbeiterMin || z.mitarbeiter.zahl > f.mitarbeiterMax)) return false;
  if (z.mitarbeiter?.zahl == null && z.mitarbeiter?.klasse) {
    const u = klassenUeberlappung(z.mitarbeiter.klasse, f.mitarbeiterMin, f.mitarbeiterMax);
    if (u !== null && u === 0) return false;
  }
  return true;
}

export function ladeLaufErgebnisse(runId: number, opt: ErgebnisOptionen = {}, db: Db = getDb()): { zeilen: ErgebnisZeile[]; total: number; filter: LaufFilter } | null {
  const run = db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.id, runId)).get();
  if (!run) return null;
  const filter = LaufFilterSchema.parse(run.filter);
  const mindest = opt.mindestScore ?? filter.mindestScore;
  const nurVerifiziert = opt.nurVerifizierteEmail ?? filter.nurVerifizierteEmail;

  const basis = db
    .select()
    .from(schema.lauffirmen)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.lauffirmen.companyId))
    .where(and(eq(schema.lauffirmen.runId, runId), ...(opt.companyIds ? [inArray(schema.lauffirmen.companyId, opt.companyIds)] : [])))
    .orderBy(desc(schema.lauffirmen.gesamtScore), schema.companies.id)
    .all();
  if (!basis.length) return { zeilen: [], total: 0, filter };
  const ids = basis.map((b) => b.companies.id);

  const ergebnisse = db.select().from(schema.kontaktErgebnisse).where(and(inArray(schema.kontaktErgebnisse.companyId, ids), eq(schema.kontaktErgebnisse.rolleKey, filter.zielRolle))).all();
  const kontakte = db.select().from(schema.contactPoints).where(inArray(schema.contactPoints.companyId, ids)).all();
  const personen = db.select().from(schema.persons).where(inArray(schema.persons.companyId, ids)).all();
  const uebernommen = new Set(db.select({ c: schema.leads.leadgenCompanyId }).from(schema.leads).where(inArray(schema.leads.leadgenCompanyId, ids)).all().map((l) => l.c));

  const alle: ErgebnisZeile[] = basis.map(({ companies: c, lauf_firmen: l }) => {
    const e = ergebnisse.find((x) => x.companyId === c.id);
    const cp = e?.contactPointId ? kontakte.find((k) => k.id === e.contactPointId) : undefined;
    const p = e?.personId ? personen.find((x) => x.id === e.personId) : undefined;
    const herk = (c.herkunft ?? {}) as Record<string, unknown>;
    const feldHerkunft: Record<string, FeldQuelle> = {};
    for (const f of ['name', 'rechtsform', 'strasse', 'plz', 'ort', 'bundesland', 'domain', 'mitarbeiter', 'branche']) {
      const s = slim(herk[f]);
      if (s) feldHerkunft[f] = s;
    }
    const cpHerkunft = (cp?.herkunft ?? {}) as { quellen?: string[]; muster?: string | null };
    const hinweise: string[] = [];
    if (e?.rollenTreffer === 'fallback') hinweise.push('rolle_fallback');
    if (cp?.status === 'catch_all_best_guess') hinweise.push('catch_all');
    if (cp?.status === 'generisch' || cp?.status === 'generisch_unverifiziert') hinweise.push('generisch');
    if (!c.branche) hinweise.push('branche_unbekannt');
    if (c.mitarbeiterZahl === null && !c.mitarbeiterKlasse) hinweise.push('mitarbeiter_unbekannt');
    if (e?.status === 'rolle_offen') hinweise.push('rolle_offen');
    return {
      companyId: c.id,
      firma: c.rechtsform ? `${c.name} ${c.rechtsform}` : c.name,
      rechtsform: c.rechtsform,
      strasse: c.strasse,
      plz: c.plz,
      ort: c.ort,
      bundesland: c.bundesland,
      domain: c.domain,
      branche: c.branche,
      brancheKonfidenz: c.brancheKonfidenz,
      mitarbeiter: c.mitarbeiterTyp || c.mitarbeiterKlasse ? { zahl: c.mitarbeiterZahl, typ: c.mitarbeiterTyp, klasse: c.mitarbeiterKlasse } : null,
      person: p ? { id: p.id, vorname: p.vorname, nachname: p.nachname, rolle: p.rolle, rolleText: p.rolleText, rollenTreffer: e?.rollenTreffer ?? null, quelle: slim((p.herkunft as { rolle?: unknown } | null)?.rolle) } : null,
      email: cp && cp.typ === 'email' ? { adresse: cp.wert, status: cp.status, konfidenz: cp.konfidenz, muster: cp.muster, verifiziertAm: cp.verifiziertAm?.getTime() ?? null, quellen: cpHerkunft.quellen ?? [] } : null,
      telefone: kontakte.filter((k) => k.companyId === c.id && k.typ === 'telefon').map((k) => ({ wert: k.wert, art: k.art, quelle: (k.herkunft as { quelle?: string } | null)?.quelle ?? null })),
      scores: { icp: l.icpScore, daten: l.datenScore, gesamt: l.gesamtScore },
      herkunft: feldHerkunft,
      hinweise,
      uebernommen: uebernommen.has(c.id),
    };
  });

  const gefiltert = alle
    .filter((z) => passtZumFilter(z, filter))
    .filter((z) => (z.scores.gesamt ?? 0) >= mindest)
    .filter((z) => !nurVerifiziert || z.email?.status === 'gueltig');
  const offset = opt.offset ?? 0;
  return { zeilen: gefiltert.slice(offset, opt.limit ? offset + opt.limit : undefined), total: gefiltert.length, filter };
}
