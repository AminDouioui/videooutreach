import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { registerSchluessel } from '../normalize/register';
import { blockingSchluessel, normalisiereDomain, personenSchluessel, vergleicheFirmen, vergleichePersonen, type FirmaMerkmale, type MatchErgebnis } from './match';

// Stufe 3: Entity Resolution. Ein Unternehmen existiert genau einmal, egal aus wie vielen Quellen es kommt.
// Ablauf je Rohdokument: Satz aus den Beobachtungen lesen → Blocking → paarweiser Vergleich → sicher: zusammenführen,
// unsicher: eigene Firma anlegen + zur manuellen Prüfung markieren, sonst getrennt lassen. Ergebnis: stabile company_id/person_id
// und die Zuordnung Quelle → Entität (entity_map). Die Beobachtungen bekommen ihre entity_id nachgetragen.

type Tx = Db;

export type Quellsatz = FirmaMerkmale & {
  rawDocumentId: number;
  quelle: string;
  referenz: string;
  name: string;
  rechtsform: string | null;
  bundesland: string | null;
  personen: Array<{ vorname: string | null; nachname: string }>;
};

export type ResolveErgebnis = {
  dokumente: number;
  neueFirmen: number;
  zusammengefuehrt: number;
  zurPruefung: number;
  versionenNachgezogen: number;
  neuePersonen: number;
  personenZusammengefuehrt: number;
  personenZurPruefung: number;
};

const leer = (): ResolveErgebnis => ({ dokumente: 0, neueFirmen: 0, zusammengefuehrt: 0, zurPruefung: 0, versionenNachgezogen: 0, neuePersonen: 0, personenZusammengefuehrt: 0, personenZurPruefung: 0 });

/** Liest die normalisierten Felder eines Rohdokuments aus den Beobachtungen. */
export function ladeQuellsatz(rawDocumentId: number, db: Db = getDb()): Quellsatz | null {
  const doc = db.select().from(schema.rawDocuments).where(eq(schema.rawDocuments.id, rawDocumentId)).get();
  if (!doc) return null;
  const obs = db.select().from(schema.attributeObservations).where(eq(schema.attributeObservations.rawDocumentId, rawDocumentId)).all();
  const feld = (name: string): string | null => {
    const w = obs.find((o) => o.entityType === 'company' && o.feld === name)?.wert;
    return typeof w === 'string' && w ? w : null;
  };
  const name = feld('name');
  if (!name) return null;
  const regKey = registerSchluessel({ art: feld('registerart'), nummer: feld('registernummer'), gericht: feld('registergericht') });
  return {
    rawDocumentId,
    quelle: doc.quelle,
    referenz: doc.referenz,
    name,
    rechtsform: feld('rechtsform'),
    nameNormalized: feld('name_normalized') ?? name,
    registerKey: regKey,
    strasse: feld('strasse'),
    plz: feld('plz'),
    ort: feld('ort') ?? feld('sitz'),
    bundesland: feld('bundesland'),
    domain: normalisiereDomain(feld('domain')),
    personen: obs
      .filter((o) => o.entityType === 'person' && o.feld === 'person')
      .map((o) => o.wert as { vorname: string | null; nachname: string })
      .filter((p) => p && typeof p.nachname === 'string'),
  };
}

function ladeFirmaMerkmale(tx: Tx, id: number): FirmaMerkmale | null {
  const c = tx.select().from(schema.companies).where(eq(schema.companies.id, id)).get();
  return c ? { nameNormalized: c.nameNormalized, registerKey: c.registerKey, plz: c.plz, ort: c.ort, strasse: c.strasse, domain: c.domain } : null;
}

function schreibeBlocks(tx: Tx, companyId: number, m: FirmaMerkmale): void {
  for (const schluessel of blockingSchluessel(m)) tx.insert(schema.companyBlocks).values({ companyId, schluessel }).onConflictDoNothing().run();
}

function findeBesten(tx: Tx, satz: Quellsatz): { id: number; ergebnis: MatchErgebnis } | null {
  const keys = blockingSchluessel(satz);
  if (!keys.length) return null;
  const ids = tx.selectDistinct({ id: schema.companyBlocks.companyId }).from(schema.companyBlocks).where(inArray(schema.companyBlocks.schluessel, keys)).all();
  let bester: { id: number; ergebnis: MatchErgebnis } | null = null;
  for (const { id } of ids) {
    const m = ladeFirmaMerkmale(tx, id);
    if (!m) continue;
    const ergebnis = vergleicheFirmen(satz, m);
    // Bei Gleichstand gewinnt die ältere Firma (kleinere id): reproduzierbar
    if (ergebnis.entscheidung !== 'getrennt' && (!bester || ergebnis.score > bester.ergebnis.score || (ergebnis.score === bester.ergebnis.score && id < bester.id))) bester = { id, ergebnis };
  }
  return bester;
}

function legeFirmaAn(tx: Tx, satz: Quellsatz): number {
  const id = tx
    .insert(schema.companies)
    .values({ name: satz.name, rechtsform: satz.rechtsform, nameNormalized: satz.nameNormalized, registerKey: satz.registerKey, strasse: satz.strasse, plz: satz.plz, ort: satz.ort, bundesland: satz.bundesland, domain: satz.domain })
    .returning({ id: schema.companies.id })
    .get().id;
  schreibeBlocks(tx, id, satz);
  return id;
}

function setzeEntityId(tx: Tx, rawDocumentId: number, companyId: number): void {
  tx.update(schema.attributeObservations)
    .set({ entityId: companyId })
    .where(and(eq(schema.attributeObservations.rawDocumentId, rawDocumentId), eq(schema.attributeObservations.entityType, 'company'), isNull(schema.attributeObservations.entityId)))
    .run();
}

/** Ordnet die Personen des Quellsatzes Personen der Firma zu (Personen-Matching innerhalb der Firma). */
function loesePersonenAuf(tx: Tx, satz: Quellsatz, companyId: number, erg: ResolveErgebnis): void {
  const bestand = () => tx.select().from(schema.persons).where(eq(schema.persons.companyId, companyId)).all();
  for (const p of satz.personen) {
    const key = personenSchluessel(p);
    const mapRef = `${satz.referenz}#${key}`;
    const vorhanden = tx.select().from(schema.entityMap).where(and(eq(schema.entityMap.quelle, satz.quelle), eq(schema.entityMap.referenz, mapRef), eq(schema.entityMap.entityType, 'person'))).get();
    let personId: number;
    if (vorhanden) {
      personId = vorhanden.entityId;
    } else {
      let bester: { id: number; ergebnis: MatchErgebnis } | null = null;
      for (const kandidat of bestand()) {
        const ergebnis = vergleichePersonen(p, kandidat);
        if (ergebnis.entscheidung !== 'getrennt' && (!bester || ergebnis.score > bester.ergebnis.score)) bester = { id: kandidat.id, ergebnis };
      }
      let status: 'neu' | 'sicher' | 'unsicher' = 'neu';
      let score = 1;
      if (bester?.ergebnis.entscheidung === 'sicher') {
        personId = bester.id;
        status = 'sicher';
        score = bester.ergebnis.score;
        erg.personenZusammengefuehrt++;
      } else {
        personId = tx.insert(schema.persons).values({ companyId, vorname: p.vorname, nachname: p.nachname, nameKey: key }).returning({ id: schema.persons.id }).get().id;
        erg.neuePersonen++;
        if (bester) {
          // Ähnliche Person gefunden, aber nicht sicher genug: eigene Person, im Status markiert (Prüfliste über entity_map.status)
          status = 'unsicher';
          score = bester.ergebnis.score;
          erg.personenZurPruefung++;
        }
      }
      tx.insert(schema.entityMap).values({ quelle: satz.quelle, referenz: mapRef, entityType: 'person', entityId: personId, matchScore: score, status }).run();
    }
    // Beobachtung dieser Person (gleicher Name im selben Rohdokument) der Person zuordnen
    tx.run(
      sql`update attribute_observations set entity_id = ${personId} where raw_document_id = ${satz.rawDocumentId} and entity_type = 'person' and feld = 'person' and entity_id is null and lower(json_extract(wert, '$.nachname')) = ${p.nachname.toLowerCase()} and coalesce(lower(json_extract(wert, '$.vorname')), '') = ${(p.vorname ?? '').toLowerCase()}`,
    );
  }
}

/**
 * Löst alle Rohdokumente ohne Zuordnung auf (ältere zuerst, damit das Ergebnis reproduzierbar ist). Eine neue Version eines
 * bereits zugeordneten Dokuments erbt die Firma ohne erneuten Vergleich; nur ihre Beobachtungen werden nachgetragen.
 */
export function loeseEntitaetenAuf(db: Db = getDb()): ResolveErgebnis {
  const erg = leer();
  const offen = db
    .select({ id: schema.rawDocuments.id })
    .from(schema.rawDocuments)
    .where(sql`exists (select 1 from attribute_observations o where o.raw_document_id = ${schema.rawDocuments.id} and o.entity_type = 'company' and o.entity_id is null)`)
    .orderBy(schema.rawDocuments.id)
    .all();
  for (const { id } of offen) {
    db.transaction((tx) => {
      const satz = ladeQuellsatz(id, tx as unknown as Db);
      if (!satz) return;
      erg.dokumente++;
      const t = tx as unknown as Tx;
      const bekannt = t.select().from(schema.entityMap).where(and(eq(schema.entityMap.quelle, satz.quelle), eq(schema.entityMap.referenz, satz.referenz), eq(schema.entityMap.entityType, 'company'))).get();
      let companyId: number;
      if (bekannt) {
        companyId = bekannt.entityId;
        erg.versionenNachgezogen++;
      } else {
        const bester = findeBesten(t, satz);
        if (bester?.ergebnis.entscheidung === 'sicher') {
          companyId = bester.id;
          t.insert(schema.entityMap).values({ quelle: satz.quelle, referenz: satz.referenz, entityType: 'company', entityId: companyId, matchScore: bester.ergebnis.score, status: 'sicher' }).run();
          // Neue Hinweise (z. B. Domain oder PLZ aus der zweiten Quelle) verbessern künftiges Blocking
          schreibeBlocks(t, companyId, satz);
          erg.zusammengefuehrt++;
        } else {
          companyId = legeFirmaAn(t, satz);
          erg.neueFirmen++;
          const unsicher = bester?.ergebnis.entscheidung === 'unsicher';
          t.insert(schema.entityMap)
            .values({ quelle: satz.quelle, referenz: satz.referenz, entityType: 'company', entityId: companyId, matchScore: bester?.ergebnis.score ?? 1, status: unsicher ? 'unsicher' : 'neu' })
            .run();
          if (unsicher && bester) {
            t.insert(schema.matchReview).values({ companyId, kandidatId: bester.id, score: bester.ergebnis.score, details: bester.ergebnis.details }).onConflictDoNothing().run();
            erg.zurPruefung++;
          }
        }
      }
      setzeEntityId(t, id, companyId);
      loesePersonenAuf(t, satz, companyId, erg);
    });
  }
  return erg;
}

/** Offene Prüffälle mit beiden Firmen (für die manuelle Prüfung). */
export function offenePruefFaelle(db: Db = getDb()) {
  return db
    .select()
    .from(schema.matchReview)
    .where(eq(schema.matchReview.status, 'offen'))
    .orderBy(sql`${schema.matchReview.score} desc`)
    .all();
}

/**
 * Prüfer bestätigt: beide Firmen sind dieselbe. Die neu angelegte Firma geht in der Kandidatin auf (Zuordnungen, Beobachtungen,
 * Personen und Blocking-Schlüssel wandern mit), danach werden doppelte Personen zusammengeführt. Die id der Kandidatin bleibt stabil.
 */
export function bestaetigeMatch(reviewId: number, db: Db = getDb()): void {
  db.transaction((tx) => {
    const t = tx as unknown as Tx;
    const r = t.select().from(schema.matchReview).where(eq(schema.matchReview.id, reviewId)).get();
    if (!r || r.status !== 'offen') throw new Error('Prüffall nicht gefunden oder bereits entschieden.');
    const verlierer = r.companyId;
    const gewinner = r.kandidatId;
    const v = t.select().from(schema.companies).where(eq(schema.companies.id, verlierer)).get();
    const g = t.select().from(schema.companies).where(eq(schema.companies.id, gewinner)).get();
    if (!v || !g) throw new Error('Eine der beiden Firmen existiert nicht mehr.');
    // Ein Registerschlüssel der Verliererin darf nicht verloren gehen, wenn die Gewinnerin keinen hat
    t.update(schema.companies).set({ registerKey: null }).where(eq(schema.companies.id, verlierer)).run();
    if (!g.registerKey && v.registerKey) t.update(schema.companies).set({ registerKey: v.registerKey }).where(eq(schema.companies.id, gewinner)).run();
    t.update(schema.entityMap).set({ entityId: gewinner, status: 'manuell' }).where(and(eq(schema.entityMap.entityType, 'company'), eq(schema.entityMap.entityId, verlierer))).run();
    t.update(schema.attributeObservations).set({ entityId: gewinner }).where(and(eq(schema.attributeObservations.entityType, 'company'), eq(schema.attributeObservations.entityId, verlierer))).run();
    t.update(schema.persons).set({ companyId: gewinner }).where(eq(schema.persons.companyId, verlierer)).run();
    for (const b of t.select().from(schema.companyBlocks).where(eq(schema.companyBlocks.companyId, verlierer)).all()) {
      t.insert(schema.companyBlocks).values({ companyId: gewinner, schluessel: b.schluessel }).onConflictDoNothing().run();
    }
    t.update(schema.matchReview).set({ status: 'zusammengefuehrt' }).where(eq(schema.matchReview.id, reviewId)).run();
    // Offene Prüffälle der Verliererin zeigen jetzt auf die Gewinnerin oder entfallen
    t.delete(schema.matchReview).where(and(eq(schema.matchReview.status, 'offen'), sql`(company_id = ${verlierer} or kandidat_id = ${verlierer})`)).run();
    t.delete(schema.companies).where(eq(schema.companies.id, verlierer)).run();
    fuehrePersonenZusammen(t, gewinner);
  });
}

/** Prüfer entscheidet: zwei verschiedene Firmen. Die Firmen bleiben getrennt, der Fall wird nicht wieder vorgeschlagen. */
export function lehneMatchAb(reviewId: number, db: Db = getDb()): void {
  const res = db.update(schema.matchReview).set({ status: 'getrennt' }).where(and(eq(schema.matchReview.id, reviewId), eq(schema.matchReview.status, 'offen'))).run();
  if (res.changes === 0) throw new Error('Prüffall nicht gefunden oder bereits entschieden.');
}

/** Führt nach einer Firmen-Zusammenführung doppelte Personen derselben Firma zusammen (nur sichere Treffer). */
function fuehrePersonenZusammen(tx: Tx, companyId: number): void {
  const liste = tx.select().from(schema.persons).where(eq(schema.persons.companyId, companyId)).orderBy(schema.persons.id).all();
  const entfernt = new Set<number>();
  for (let i = 0; i < liste.length; i++) {
    if (entfernt.has(liste[i].id)) continue;
    for (let j = i + 1; j < liste.length; j++) {
      if (entfernt.has(liste[j].id)) continue;
      if (vergleichePersonen(liste[i], liste[j]).entscheidung !== 'sicher') continue;
      tx.update(schema.entityMap).set({ entityId: liste[i].id, status: 'manuell' }).where(and(eq(schema.entityMap.entityType, 'person'), eq(schema.entityMap.entityId, liste[j].id))).run();
      tx.update(schema.attributeObservations).set({ entityId: liste[i].id }).where(and(eq(schema.attributeObservations.entityType, 'person'), eq(schema.attributeObservations.entityId, liste[j].id))).run();
      tx.delete(schema.persons).where(eq(schema.persons.id, liste[j].id)).run();
      entfernt.add(liste[j].id);
    }
  }
}

export type ResolutionKennzahlen = { quellsaetze: number; firmen: number; offenePruefFaelle: number; personen: number };

export function ladeResolutionKennzahlen(db: Db = getDb()): ResolutionKennzahlen {
  const n = (q: ReturnType<typeof sql>) => db.all<{ n: number }>(q)[0]?.n ?? 0;
  return {
    quellsaetze: n(sql`select count(*) as n from entity_map where entity_type = 'company'`),
    firmen: n(sql`select count(*) as n from companies`),
    offenePruefFaelle: n(sql`select count(*) as n from match_review where status = 'offen'`),
    personen: n(sql`select count(*) as n from persons`),
  };
}
