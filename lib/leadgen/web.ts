import { and, eq } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { findeDomain, hostVon } from './crawl/domain-finder';
import { seitenText, waehleSeiten, type SeitenArt } from './crawl/seiten';
import { blockingSchluessel } from './resolve/match';
import type { LeadgenDeps } from './deps';

// Stufe 4: Domain-Ermittlung und Crawling. Ergebnisse landen in `domains` und `crawl_pages`, der Seiteninhalt unverändert in raw_documents.

export type DomainStufe = { status: 'gefunden' | 'nicht_gefunden' | 'schon_vorhanden'; domain?: string; beleg?: string };

function ladeFirma(db: Db, companyId: number) {
  const c = db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  if (!c) throw new Error(`Firma ${companyId} existiert nicht.`);
  return c;
}

/** Sucht und verifiziert die Domain. Eine schon bestätigte Domain wird nicht noch einmal gesucht. */
export async function ermittleDomain(companyId: number, deps: Pick<LeadgenDeps, 'suche' | 'fetcher'>, db: Db = getDb()): Promise<DomainStufe> {
  const c = ladeFirma(db, companyId);
  const vorhanden = db.select().from(schema.domains).where(and(eq(schema.domains.companyId, companyId), eq(schema.domains.verifiziert, true))).get();
  if (vorhanden) return { status: 'schon_vorhanden', domain: vorhanden.domain };
  const reg = c.registerKey?.split('|') ?? [];
  const ergebnis = await findeDomain(
    { name: c.name, nameNormalized: c.nameNormalized, rechtsform: c.rechtsform, ort: c.ort, plz: c.plz, registerArt: reg[1] ?? null, registerNummer: reg[2] ?? null },
    deps.suche,
    deps.fetcher,
  );
  if (!ergebnis) return { status: 'nicht_gefunden' };
  db.transaction((tx) => {
    tx.insert(schema.domains)
      .values({ companyId, domain: ergebnis.domain, startUrl: ergebnis.startUrl, verifiziert: true, beleg: ergebnis.beleg, methode: `suche:${deps.suche.name}`, konfidenz: ergebnis.konfidenz })
      .onConflictDoUpdate({ target: [schema.domains.companyId, schema.domains.domain], set: { startUrl: ergebnis.startUrl, verifiziert: true, beleg: ergebnis.beleg, konfidenz: ergebnis.konfidenz, geprueftAm: new Date() } })
      .run();
    tx.update(schema.companies).set({ domain: ergebnis.domain }).where(eq(schema.companies.id, companyId)).run();
    tx.insert(schema.attributeObservations).values({ entityType: 'company', entityId: companyId, feld: 'domain', wert: ergebnis.domain, quelle: `suche:${deps.suche.name}`, konfidenz: ergebnis.konfidenz }).run();
    // Die Domain hilft künftig beim Blocking (zweite Quelle mit derselben Domain trifft diese Firma)
    for (const schluessel of blockingSchluessel({ nameNormalized: c.nameNormalized, registerKey: c.registerKey, plz: c.plz, domain: ergebnis.domain })) {
      tx.insert(schema.companyBlocks).values({ companyId, schluessel }).onConflictDoNothing().run();
    }
  });
  return { status: 'gefunden', domain: ergebnis.domain, beleg: ergebnis.beleg };
}

export type CrawlStufe = { startseite: boolean; seiten: number; robots: number; fehler: number; ausCache: number };

/** Ruft Startseite, Impressum, Kontakt und Team-Seiten der bestätigten Domain ab (robots.txt, Rate-Limit und Cache im Fetcher). */
export async function crawleFirma(companyId: number, deps: Pick<LeadgenDeps, 'fetcher'>, db: Db = getDb()): Promise<CrawlStufe> {
  const dom = db.select().from(schema.domains).where(and(eq(schema.domains.companyId, companyId), eq(schema.domains.verifiziert, true))).get();
  if (!dom) throw new Error('Keine bestätigte Domain: erst die Domain-Ermittlung ausführen.');
  const erg: CrawlStufe = { startseite: false, seiten: 0, robots: 0, fehler: 0, ausCache: 0 };
  const merke = (url: string, art: SeitenArt, r: Awaited<ReturnType<typeof deps.fetcher.holeSeite>>) => {
    const rawId = r.status === 'ok' ? r.rawDocumentId : null;
    const fehler = r.status === 'fehler' ? r.fehler : null;
    db.insert(schema.crawlPages)
      .values({ companyId, url, art, rawDocumentId: rawId, status: r.status, fehler })
      .onConflictDoUpdate({ target: [schema.crawlPages.companyId, schema.crawlPages.url], set: { art, rawDocumentId: rawId, status: r.status, fehler, abgerufenAm: new Date() } })
      .run();
    if (r.status === 'ok') {
      erg.seiten++;
      if (r.ausCache) erg.ausCache++;
    } else if (r.status === 'robots') erg.robots++;
    else erg.fehler++;
  };
  const startUrl = dom.startUrl ?? `https://${dom.domain}/`;
  const start = await deps.fetcher.holeSeite(startUrl);
  merke(startUrl, 'start', start);
  if (start.status !== 'ok') return erg;
  erg.startseite = true;
  for (const z of waehleSeiten(start.html, start.finaleUrl)) {
    if (hostVon(z.url) !== dom.domain) continue;
    merke(z.url, z.art, await deps.fetcher.holeSeite(z.url));
  }
  return erg;
}

/** Sichtbarer Text einer gecrawlten Seite (aus der Rohdaten-Schicht, ohne neuen Abruf). */
export function ladeSeitenText(rawDocumentId: number, db: Db = getDb()): string {
  const doc = db.select().from(schema.rawDocuments).where(eq(schema.rawDocuments.id, rawDocumentId)).get();
  return doc ? seitenText(doc.inhalt) : '';
}
