import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { STANDARD_ICP, type IcpKonfig } from '../config';
import { standardRollen } from '../contacts/rollen';
import { ROLLEN_FAKTOR } from '../contacts/rollen';
import { registerSchluessel } from '../normalize/register';
import { berechneDatenScore, berechneIcpScore, type DatenScore, type FeldHerkunft, type GoldenFirma, type IcpScore } from '../score';
import { aktuelleBeobachtungen, hgbKlasseVonZahl, mitarbeiterKlasse, waehleGewinner, type Beobachtung, type Gewinner } from './survivorship';

// Stufe 7: Golden Record. `companies`, `persons` und `contact_points` sind eine abgeleitete Sicht auf die Beobachtungen
// (`attribute_observations`) und jederzeit neu berechenbar. Pro Feld steht die Herkunft (Quelle, Konfidenz, Zeitpunkt, Beobachtung)
// im JSON `herkunft`. Die Mitarbeiterzahl trägt immer Typ (exakt, Größenklasse, Schätzung) und Herkunft.

export type GoldenErgebnis = { companyId: number; felder: number; personen: number; datenScore: DatenScore; icpScore: IcpScore };

const text = (g: Gewinner | undefined): string | null => (g && typeof g.wert === 'string' && g.wert ? g.wert : null);

function alsBeobachtung(o: typeof schema.attributeObservations.$inferSelect): Beobachtung {
  return { id: o.id, feld: o.feld, wert: o.wert, quelle: o.quelle, konfidenz: o.konfidenz, typ: o.typ, beobachtetAm: o.beobachtetAm.getTime(), extraktionRunId: o.extraktionRunId };
}

function nachFeld(beobachtungen: Beobachtung[]): Map<string, Beobachtung[]> {
  const m = new Map<string, Beobachtung[]>();
  for (const b of beobachtungen) m.set(b.feld, [...(m.get(b.feld) ?? []), b]);
  return m;
}

const herkunftEintrag = (g: Gewinner) => ({ wert: g.wert, quelle: g.quelle, konfidenz: Math.round(g.konfidenz * 1000) / 1000, konfidenzRoh: g.konfidenzRoh, typ: g.typ, beobachtetAm: g.beobachtetAm, beobachtungId: g.beobachtungId });

const EMAIL_RANG: Record<string, number> = { gueltig: 0, catch_all_best_guess: 1, generisch: 2, generisch_unverifiziert: 3 };

/**
 * Berechnet den Golden Record einer Firma aus ihren Beobachtungen neu: Stammdaten, Adresse, Domain, Mitarbeiterzahl, Branche,
 * Rolle je Person, danach die Scores. Idempotent: derselbe Beobachtungsstand ergibt denselben Golden Record.
 */
export function berechneGolden(companyId: number, opt: { db?: Db; jetzt?: number; icp?: IcpKonfig; zielRolleKey?: string } = {}): GoldenErgebnis {
  const db = opt.db ?? getDb();
  const jetzt = opt.jetzt ?? Date.now();
  const c = db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  if (!c) throw new Error(`Firma ${companyId} existiert nicht.`);
  const personen = db.select().from(schema.persons).where(eq(schema.persons.companyId, companyId)).all();
  const ids = personen.map((p) => p.id);
  const firmaObs = db.select().from(schema.attributeObservations).where(and(eq(schema.attributeObservations.entityType, 'company'), eq(schema.attributeObservations.entityId, companyId))).all();
  const personObs = ids.length ? db.select().from(schema.attributeObservations).where(and(eq(schema.attributeObservations.entityType, 'person'), inArray(schema.attributeObservations.entityId, ids))).all() : [];

  // Ein neuerer Extraktionslauf ersetzt die Beobachtungen des älteren (firmenweit, vor dem Gruppieren nach Feld)
  const aktuell = aktuelleBeobachtungen([...firmaObs, ...personObs]);
  const firmaFelder = nachFeld(aktuell.filter((o) => o.entityType === 'company').map(alsBeobachtung));
  const gewinner = new Map<string, Gewinner>();
  for (const [feld, liste] of firmaFelder) {
    const g = waehleGewinner(feld, liste, jetzt);
    if (g) gewinner.set(feld, g);
  }

  const herkunft: Record<string, unknown> = {};
  const aendern: Partial<typeof schema.companies.$inferInsert> = {};
  const setze = <K extends keyof typeof schema.companies.$inferInsert>(spalte: K, feld: string, wert: (typeof schema.companies.$inferInsert)[K] | null) => {
    const g = gewinner.get(feld);
    if (g && wert !== null && wert !== undefined) {
      (aendern as Record<string, unknown>)[spalte] = wert;
      herkunft[feld] = herkunftEintrag(g);
    }
  };
  setze('name', 'name', text(gewinner.get('name')));
  setze('rechtsform', 'rechtsform', text(gewinner.get('rechtsform')));
  setze('nameNormalized', 'name_normalized', text(gewinner.get('name_normalized')));
  setze('strasse', 'strasse', text(gewinner.get('strasse')));
  setze('plz', 'plz', text(gewinner.get('plz')));
  setze('ort', 'ort', text(gewinner.get('ort')));
  setze('bundesland', 'bundesland', text(gewinner.get('bundesland')));
  setze('domain', 'domain', text(gewinner.get('domain')));
  for (const f of ['sitz', 'status', 'registerart', 'registernummer', 'registergericht']) {
    const g = gewinner.get(f);
    if (g) herkunft[f] = herkunftEintrag(g);
  }
  // Registerschlüssel (harter Match): nur setzen, wenn er sich ergibt und keiner anderen Firma gehört
  const key = registerSchluessel({ art: text(gewinner.get('registerart')), nummer: text(gewinner.get('registernummer')), gericht: text(gewinner.get('registergericht')) });
  if (key && key !== c.registerKey && !db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.registerKey, key)).get()) aendern.registerKey = key;

  // Mitarbeiterzahl: exakt vor Klasse vor Schätzung, dann Quelle; immer mit Typ und Herkunft
  const ma = gewinner.get('mitarbeiter');
  if (ma) {
    const w = ma.wert as { zahl?: number; klasse?: string };
    if (typeof w.zahl === 'number' && Number.isFinite(w.zahl)) {
      aendern.mitarbeiterZahl = Math.round(w.zahl);
      aendern.mitarbeiterTyp = ma.typ;
      aendern.mitarbeiterKlasse = ma.typ === 'klasse' ? hgbKlasseVonZahl(w.zahl) : mitarbeiterKlasse(w.zahl);
    } else if (typeof w.klasse === 'string') {
      aendern.mitarbeiterZahl = null;
      aendern.mitarbeiterTyp = 'klasse';
      aendern.mitarbeiterKlasse = w.klasse;
    }
    herkunft.mitarbeiter = herkunftEintrag(ma);
  }

  // Branche: belegte Webseiten-Klassifikation ab Konfidenz 0,6, sonst WZ-Zuordnung, sonst die schwächere Webseiten-Angabe
  const web = gewinner.get('branche_web');
  const wz = gewinner.get('branche_wz');
  const waehle = web && web.konfidenz >= 0.6 ? web : (wz ?? web);
  if (waehle) {
    aendern.branche = (waehle.wert as { branche: string }).branche;
    aendern.brancheKonfidenz = Math.round(waehle.konfidenz * 1000) / 1000;
    herkunft.branche = herkunftEintrag(waehle);
  }

  // Personen: beste Rolle je Person
  const personRollen = new Map<number, { g: Gewinner; rolleKey: string | null }>();
  for (const p of personen) {
    const liste = aktuell.filter((o) => o.entityType === 'person' && o.entityId === p.id && o.feld === 'person').map(alsBeobachtung);
    const g = waehleGewinner('person', liste, jetzt);
    if (!g) continue;
    const w = g.wert as { rolle?: string; rolleOriginal?: string | null };
    const rolleText = w.rolleOriginal || w.rolle || null;
    const klass = rolleText ? standardRollen.klassifiziere(rolleText) : null;
    const rolleKey = klass?.key ?? w.rolle ?? null;
    personRollen.set(p.id, { g, rolleKey });
    db.update(schema.persons).set({ rolle: rolleKey, rolleText, herkunft: { rolle: herkunftEintrag(g) } }).where(eq(schema.persons.id, p.id)).run();
  }

  const jetztDatum = new Date(jetzt);
  db.update(schema.companies).set({ ...aendern, herkunft, goldenBerechnetAm: jetztDatum }).where(eq(schema.companies.id, companyId)).run();

  // Scoring auf dem frisch berechneten Golden Record
  const golden = ladeGoldenFirma(companyId, db, jetzt, opt.zielRolleKey);
  const datenScore = berechneDatenScore(golden, jetzt);
  const icpScore = berechneIcpScore(golden, opt.icp ?? STANDARD_ICP);
  const details = { daten: datenScore, icp: icpScore };
  db.insert(schema.scores).values({ companyId, datenScore: datenScore.score, icpScore: icpScore.score, details, berechnetAm: jetztDatum }).onConflictDoUpdate({ target: schema.scores.companyId, set: { datenScore: datenScore.score, icpScore: icpScore.score, details, berechnetAm: jetztDatum } }).run();
  return { companyId, felder: Object.keys(herkunft).length, personen: personRollen.size, datenScore, icpScore };
}

/** Golden-Sicht einer Firma für das Scoring (aus den abgeleiteten Tabellen, nicht aus den Beobachtungen). */
export function ladeGoldenFirma(companyId: number, db: Db, jetzt: number, zielRolleKey?: string): GoldenFirma {
  const c = db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  if (!c) throw new Error(`Firma ${companyId} existiert nicht.`);
  const herk = (c.herkunft ?? {}) as Record<string, { konfidenz?: number; beobachtetAm?: number }>;
  const herkunft: Record<string, FeldHerkunft | undefined> = {};
  // Nur Schlüsselfelder, die in Konfidenz und Aktualität einfließen
  for (const f of ['name', 'strasse', 'plz', 'ort', 'domain', 'mitarbeiter', 'branche']) {
    const h = herk[f];
    if (h && typeof h.konfidenz === 'number' && typeof h.beobachtetAm === 'number') herkunft[f === 'branche' ? 'branche_web' : f] = { konfidenz: h.konfidenz, beobachtetAm: h.beobachtetAm };
  }
  const ergebnis = db
    .select()
    .from(schema.kontaktErgebnisse)
    .where(and(eq(schema.kontaktErgebnisse.companyId, companyId), eq(schema.kontaktErgebnisse.status, 'gefunden'), ...(zielRolleKey ? [eq(schema.kontaktErgebnisse.rolleKey, zielRolleKey)] : [])))
    .all()
    .sort((a, b) => b.konfidenz - a.konfidenz)[0];
  let person: GoldenFirma['person'] = null;
  if (ergebnis?.personId) {
    const p = db.select().from(schema.persons).where(eq(schema.persons.id, ergebnis.personId)).get();
    const h = (p?.herkunft as { rolle?: { konfidenz?: number; beobachtetAm?: number } } | null)?.rolle;
    const faktor = ROLLEN_FAKTOR[(ergebnis.rollenTreffer as keyof typeof ROLLEN_FAKTOR) ?? 'keiner'] ?? 0;
    if (h && typeof h.konfidenz === 'number' && typeof h.beobachtetAm === 'number') person = { konfidenz: h.konfidenz * faktor, beobachtetAm: h.beobachtetAm };
  }
  const emails = db.select().from(schema.contactPoints).where(and(eq(schema.contactPoints.companyId, companyId), eq(schema.contactPoints.typ, 'email'))).all().sort((a, b) => (EMAIL_RANG[a.status] ?? 9) - (EMAIL_RANG[b.status] ?? 9) || b.konfidenz - a.konfidenz);
  const email = emails[0] ? { status: emails[0].status, konfidenz: emails[0].konfidenz, verifiziertAm: emails[0].verifiziertAm?.getTime() ?? null } : null;
  const hatTelefon = db.select({ id: schema.contactPoints.id }).from(schema.contactPoints).where(and(eq(schema.contactPoints.companyId, companyId), eq(schema.contactPoints.typ, 'telefon'))).get() !== undefined;
  void jetzt;
  return {
    name: c.name,
    strasse: c.strasse,
    plz: c.plz,
    ort: c.ort,
    bundesland: c.bundesland,
    rechtsform: c.rechtsform,
    domain: c.domain,
    branche: c.branche,
    brancheKonfidenz: c.brancheKonfidenz,
    mitarbeiterZahl: c.mitarbeiterZahl,
    mitarbeiterTyp: c.mitarbeiterTyp,
    mitarbeiterKlasse: c.mitarbeiterKlasse,
    herkunft,
    person,
    email,
    telefon: hatTelefon,
  };
}

/** Berechnet den Golden Record aller Firmen neu (z. B. nach einer Änderung der Survivorship-Regeln). */
export function berechneAlleGolden(opt: { db?: Db; jetzt?: number; icp?: IcpKonfig } = {}): number {
  const db = opt.db ?? getDb();
  const ids = db.select({ id: schema.companies.id }).from(schema.companies).all();
  for (const { id } of ids) berechneGolden(id, opt);
  return ids.length;
}
