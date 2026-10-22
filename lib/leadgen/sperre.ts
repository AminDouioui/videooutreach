import { createHmac } from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { addSuppression } from '@/lib/suppression';
import { personenSchluessel } from './resolve/match';
import { inhaltHash } from './raw-store';

// Löschfunktion pro Person und Sperre gegen Re-Importe (DSGVO). Gesperrt wird über Hashes (HMAC von Name und Firmenkennung),
// nie über den Namen selbst. Eine gelöschte Person kann so bei Import, Crawl und Suche nicht wieder auftauchen.

type PersonName = { vorname: string | null; nachname: string };
type FirmenKennung = { id?: number | null; registerKey?: string | null; domain?: string | null };

const hash = (text: string) => createHmac('sha256', getEnv().ENCRYPTION_KEY).update(text).digest('hex');

/** Hashes einer Person für jede verfügbare Firmenkennung (Registerschlüssel, Domain, Firmen-ID). */
export function sperrHashes(p: PersonName, f: FirmenKennung): string[] {
  const name = personenSchluessel(p);
  const aus: string[] = [];
  if (f.registerKey) aus.push(hash(`${name}|reg:${f.registerKey}`));
  if (f.domain) aus.push(hash(`${name}|dom:${f.domain.toLowerCase().replace(/^www\./, '')}`));
  if (f.id) aus.push(hash(`${name}|id:${f.id}`));
  return aus;
}

/** Ist die Person (für diese Firma) gesperrt? Reicht ein passender Hash. */
export function istPersonGesperrt(db: Db, p: PersonName, f: FirmenKennung): boolean {
  const h = sperrHashes(p, f);
  if (!h.length) return false;
  return !!db.select({ id: schema.personSperre.id }).from(schema.personSperre).where(inArray(schema.personSperre.hash, h)).get();
}

/** Prüfung vor der Zuordnung zu einer Firma (lädt Registerschlüssel und Domain der Firma). */
export function istPersonBeiFirmaGesperrt(db: Db, p: PersonName, companyId: number): boolean {
  const c = db.select({ registerKey: schema.companies.registerKey, domain: schema.companies.domain }).from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  return istPersonGesperrt(db, p, { id: companyId, registerKey: c?.registerKey, domain: c?.domain });
}

/** Mögliche Schreibweisen des Namens in Rohtexten (nur für das Schwärzen; bewusst eng, damit nichts Fremdes getroffen wird). */
function namensMuster(p: PersonName): RegExp[] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const n = esc(p.nachname.trim());
  const v = p.vorname ? esc(p.vorname.trim()) : null;
  const muster = [v ? `${v}\\s+${n}` : null, v ? `${n},\\s*${v}` : null, v ? `${v[0]}\\.\\s*${n}` : null].filter((x): x is string => !!x);
  return muster.map((m) => new RegExp(m, 'gi'));
}

export type LoeschErgebnis = { beobachtungen: number; kontakte: number; adressenGesperrt: number; leadsAnonymisiert: number; rohdokumenteGeschwaerzt: number };

/**
 * Löscht eine Person vollständig aus dem Golden Record und aus den abgeleiteten Daten: Beobachtungen, Kontakte, Zuordnungen,
 * Personendatensatz. Ihre Adressen kommen auf die Sperrliste (stoppt ausstehende Mails), Leads in Kampagnen werden anonymisiert, und
 * die Namens-Hashes verhindern jedes spätere Wiederauftauchen. Namen in gespeicherten Rohdokumenten werden bestmöglich geschwärzt
 * (die Rohschicht ist sonst unveränderlich; das Schwärzen ändert den Hash des Dokuments).
 */
export function loeschePerson(personId: number, opt: { db?: Db; grund?: string } = {}): LoeschErgebnis {
  const db = opt.db ?? getDb();
  const grund = opt.grund ?? 'datenloeschung';
  const p = db.select().from(schema.persons).where(eq(schema.persons.id, personId)).get();
  if (!p) throw new Error('Person nicht gefunden.');
  const c = db.select().from(schema.companies).where(eq(schema.companies.id, p.companyId)).get();
  const erg: LoeschErgebnis = { beobachtungen: 0, kontakte: 0, adressenGesperrt: 0, leadsAnonymisiert: 0, rohdokumenteGeschwaerzt: 0 };

  db.transaction((tx) => {
    const t = tx as unknown as Db;
    // 1. Sperre zuerst: ab jetzt kommt die Person nirgends mehr hinein
    for (const h of sperrHashes({ vorname: p.vorname, nachname: p.nachname }, { id: p.companyId, registerKey: c?.registerKey, domain: c?.domain })) {
      t.insert(schema.personSperre).values({ hash: h, grund }).onConflictDoNothing().run();
    }
    // 2. Adressen der Person auf die Sperrliste (stoppt ausstehende Mails), dann die Kontaktdaten löschen
    const kontakte = t.select().from(schema.contactPoints).where(eq(schema.contactPoints.personId, personId)).all();
    const adressen = new Set(kontakte.filter((k) => k.typ === 'email').map((k) => k.wert.toLowerCase()));
    for (const l of t.select({ email: schema.leads.email }).from(schema.leads).where(eq(schema.leads.leadgenPersonId, personId)).all()) adressen.add(l.email.toLowerCase());
    for (const a of adressen) addSuppression(a, grund);
    erg.adressenGesperrt = adressen.size;
    const cpIds = kontakte.map((k) => k.id);
    if (cpIds.length) {
      t.delete(schema.attributeObservations).where(and(eq(schema.attributeObservations.entityType, 'contact_point'), inArray(schema.attributeObservations.entityId, cpIds))).run();
      t.delete(schema.contactPoints).where(inArray(schema.contactPoints.id, cpIds)).run();
    }
    erg.kontakte = kontakte.length;
    // 3. Beobachtungen und Zuordnungen; die zugehörigen Rohdokumente merken (zum Schwärzen)
    const obs = t.select({ id: schema.attributeObservations.id, raw: schema.attributeObservations.rawDocumentId }).from(schema.attributeObservations).where(and(eq(schema.attributeObservations.entityType, 'person'), eq(schema.attributeObservations.entityId, personId))).all();
    const rawIds = new Set(obs.map((o) => o.raw).filter((r): r is number => r !== null));
    erg.beobachtungen = t.delete(schema.attributeObservations).where(and(eq(schema.attributeObservations.entityType, 'person'), eq(schema.attributeObservations.entityId, personId))).run().changes;
    t.delete(schema.entityMap).where(and(eq(schema.entityMap.entityType, 'person'), eq(schema.entityMap.entityId, personId))).run();
    // 4. Ergebnisse der Kontakt-Engine: die Rolle ist wieder offen, damit eine andere Person gesucht wird
    t.update(schema.kontaktErgebnisse).set({ status: 'rolle_offen', personId: null, contactPointId: null, rollenTreffer: null, konfidenz: 0, naechsteAnreicherungAt: new Date(), updatedAt: new Date() }).where(eq(schema.kontaktErgebnisse.personId, personId)).run();
    // 5. Leads in Kampagnen anonymisieren (die Adresse bleibt nur als Sperreintrag erhalten)
    const leads = t.update(schema.leads).set({ vorname: null, nachname: null, anrede: null, position: null, notizen: null, leadgenPersonId: null }).where(eq(schema.leads.leadgenPersonId, personId)).run();
    erg.leadsAnonymisiert = leads.changes;
    // 6. Person selbst
    t.delete(schema.persons).where(eq(schema.persons.id, personId)).run();

    // 7. Namen in Rohdokumenten schwärzen: Quelldokumente der Beobachtungen und die gecrawlten Seiten der Firma
    for (const r of t.select({ rawDocumentId: schema.crawlPages.rawDocumentId }).from(schema.crawlPages).where(eq(schema.crawlPages.companyId, p.companyId)).all()) if (r.rawDocumentId) rawIds.add(r.rawDocumentId);
    const muster = namensMuster({ vorname: p.vorname, nachname: p.nachname });
    for (const id of rawIds) {
      const doc = t.select().from(schema.rawDocuments).where(eq(schema.rawDocuments.id, id)).get();
      if (!doc) continue;
      let neu = doc.inhalt;
      for (const m of muster) neu = neu.replace(m, '[gelöscht]');
      if (neu === doc.inhalt) continue;
      try {
        t.update(schema.rawDocuments).set({ inhalt: neu, inhaltHash: inhaltHash(neu) }).where(eq(schema.rawDocuments.id, id)).run();
        erg.rohdokumenteGeschwaerzt++;
      } catch {
        // Ein gleichlautendes Dokument gleicher Version existiert schon: dieses hier ist dann überflüssig, bleibt aber als Verweis erhalten
      }
    }
  });
  return erg;
}

/** Wie viele Personen sind gesperrt (nur zur Anzeige). */
export function anzahlGesperrterPersonen(db: Db = getDb()): number {
  return db.all<{ n: number }>(sql`select count(*) as n from person_sperre`)[0]?.n ?? 0;
}

