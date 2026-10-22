import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { mapReacherAntwort, ReacherVerifier } from './reacher';
import { standardRollen } from './rollen';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-kontakt-'));
Object.assign(process.env, { DATA_DIR: dir, ADMIN_PASSWORD: 'x', SESSION_SECRET: 'x'.repeat(32), ENCRYPTION_KEY: '0'.repeat(64), IP_HASH_SALT: 's' });

type Mod = {
  db: typeof import('@/lib/db');
  engine: typeof import('./engine');
  steps: typeof import('./steps');
  ver: typeof import('./verifier');
  fin: typeof import('./finder');
  prov: typeof import('../extract/provider');
  search: typeof import('../search/provider');
  tel: typeof import('./telefon');
};
let m: Mod;
beforeAll(async () => {
  m = {
    db: await import('@/lib/db'),
    engine: await import('./engine'),
    steps: await import('./steps'),
    ver: await import('./verifier'),
    fin: await import('./finder'),
    prov: await import('../extract/provider'),
    search: await import('../search/provider'),
    tel: await import('./telefon'),
  };
  m.db.getDb();
});

// ---------------------------------------------------------------- Hilfen

let zaehler = 0;
type Person = { vorname: string; nachname: string; rolle: string; email?: string; quelle?: string };

/** Legt Firma mit Domain, Personen (mit Rollen-Beobachtung) und bekannten Adressen an. */
function firma(domain: string, personen: Person[], optionen: { firmaEmails?: string[]; telefone?: Array<{ e164: string; art: string; quelle?: string }> } = {}) {
  const db = m.db.getDb();
  const id = db.insert(m.db.schema.companies).values({ name: `Testfirma ${++zaehler}`, nameNormalized: `testfirma ${zaehler}`, domain, ort: 'Stuttgart' }).returning({ id: m.db.schema.companies.id }).get().id;
  const personIds: number[] = [];
  for (const p of personen) {
    const pid = db.insert(m.db.schema.persons).values({ companyId: id, vorname: p.vorname, nachname: p.nachname, nameKey: `${p.nachname}|${p.vorname}`.toLowerCase() }).returning({ id: m.db.schema.persons.id }).get().id;
    personIds.push(pid);
    db.insert(m.db.schema.attributeObservations).values({ entityType: 'person', entityId: pid, feld: 'person', wert: { vorname: p.vorname, nachname: p.nachname, rolle: 'sonstige', rolleOriginal: p.rolle, url: `https://${domain}/team` }, quelle: p.quelle ?? 'web', konfidenz: 0.8 }).run();
    if (p.email) db.insert(m.db.schema.attributeObservations).values({ entityType: 'person', entityId: pid, feld: 'email', wert: { adresse: p.email, zuordnung: 'person' }, quelle: 'web', konfidenz: 0.8 }).run();
  }
  for (const e of optionen.firmaEmails ?? []) db.insert(m.db.schema.attributeObservations).values({ entityType: 'company', entityId: id, feld: 'email', wert: { adresse: e, zuordnung: 'unbekannt' }, quelle: 'web', konfidenz: 0.9 }).run();
  for (const t of optionen.telefone ?? []) db.insert(m.db.schema.attributeObservations).values({ entityType: 'company', entityId: id, feld: 'telefon', wert: { e164: t.e164, art: t.art }, quelle: t.quelle ?? 'web', konfidenz: 0.9 }).run();
  return { id, personIds };
}

type VerifyOpt = { gueltig?: string[]; catchAll?: boolean; ungueltig?: boolean; unbekannt?: boolean; mx?: 'ok' | 'kein_mx' };
function deps(v: VerifyOpt, extra: Partial<import('./steps').KontaktDeps> = {}) {
  const fake = new m.ver.FakeVerifier((adresse) => {
    if (v.catchAll) return 'gueltig';
    if (v.unbekannt) return 'unbekannt';
    return v.gueltig?.includes(adresse) ? 'gueltig' : 'ungueltig';
  });
  const wartezeiten: number[] = [];
  let zeit = Date.now();
  const verifier = new m.ver.GedrosselterVerifier({
    verifier: fake,
    mx: async () => v.mx ?? 'ok',
    minAbstandMs: 2000,
    jetzt: () => zeit,
    warte: async (ms) => {
      wartezeiten.push(ms);
      zeit += ms;
    },
    zufall: () => 'zufallstest123',
  });
  const suche = new m.search.FakeSearchProvider(() => []);
  const fetcher = { holeSeite: async (url: string) => ({ status: 'fehler' as const, url, fehler: 'offline' }) } as unknown as import('../crawl/fetcher').HoeflicherFetcher;
  const d: import('./steps').KontaktDeps = { suche, fetcher, extraktion: new m.prov.FakeExtractionProvider(() => ({ personen: [] })), verifier, rollen: standardRollen, finder: [new m.fin.WebsiteFinder()], ...extra };
  return { d, fake, wartezeiten, suche };
}

// ---------------------------------------------------------------- Kern der Engine

describe('Kontakt-Engine: Rolle rein, verifizierte E-Mail raus', () => {
  it('lernt das Muster der Domain und verifiziert den ersten Kandidaten; restliche Kandidaten werden nicht geprüft', async () => {
    const f = firma('muster-a.de', [
      { vorname: 'Anna', nachname: 'Schmidt-Meier', rolle: 'Leiterin Einkauf' },
      { vorname: 'Hans', nachname: 'Müller', rolle: 'Geschäftsführer', email: 'h.mueller@muster-a.de' },
    ]);
    const { d, fake } = deps({ gueltig: ['a.schmidt-meier@muster-a.de'] });
    const erg = await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', d);
    expect(erg.status).toBe('gefunden');
    expect(erg.person).toMatchObject({ nachname: 'Schmidt-Meier', rolle: 'Leiterin Einkauf' });
    expect(erg.rollenTreffer).toBe('exakt');
    expect(erg.treffer).toMatchObject({ email: 'a.schmidt-meier@muster-a.de', status: 'gueltig', muster: 'v.nachname' });
    expect(erg.treffer!.konfidenz).toBeGreaterThan(0.6);
    // Nach dem Catch-All-Test (zufällige Adresse) nur genau der erste Kandidat, danach Abbruch
    expect(fake.aufrufe).toEqual(['zufallstest123@muster-a.de', 'a.schmidt-meier@muster-a.de']);

    const db = m.db.getDb();
    // Muster-Herkunft wurde gespeichert
    expect(db.select().from(m.db.schema.domainEmailPatterns).all().find((p) => p.domain === 'muster-a.de' && p.muster === 'v.nachname')?.belege).toBe(1);
    // Ergebnis als Beobachtung am Kontakt (Grundlage der Kennzahl „mit verifizierter E-Mail“) und als contact_point
    const cp = db.select().from(m.db.schema.contactPoints).all().find((c) => c.wert === 'a.schmidt-meier@muster-a.de')!;
    expect(cp).toMatchObject({ typ: 'email', status: 'gueltig', personId: f.personIds[0], muster: 'v.nachname' });
    const obs = db.select().from(m.db.schema.attributeObservations).all().find((o) => o.entityType === 'contact_point' && o.entityId === cp.id && o.feld === 'email')!;
    expect(obs.wert).toMatchObject({ adresse: 'a.schmidt-meier@muster-a.de', status: 'gueltig', rollenTreffer: 'exakt', muster: 'v.nachname' });
    const e = db.select().from(m.db.schema.kontaktErgebnisse).all().find((x) => x.companyId === f.id)!;
    expect(e).toMatchObject({ status: 'gefunden', rolleKey: 'einkauf_leitung', personId: f.personIds[0], naechsteAnreicherungAt: null });
  });

  it('ohne bekanntes Muster: Kandidaten nach Standard-Prior, 3. Kandidat gültig', async () => {
    const f = firma('muster-b.de', [{ vorname: 'Peter', nachname: 'Weiß', rolle: 'Leiter Einkauf' }]);
    const { d, fake } = deps({ gueltig: ['pweiss@muster-b.de'] });
    const erg = await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', d);
    expect(erg.treffer).toMatchObject({ email: 'pweiss@muster-b.de', status: 'gueltig', muster: 'vnachname' });
    // erster Test = Catch-All-Probe, danach in Reihenfolge der Muster-Konfidenz; die Adresse steht nie doppelt in der Liste
    expect(fake.aufrufe[1]).toBe('peter.weiss@muster-b.de');
    expect(fake.aufrufe.at(-1)).toBe('pweiss@muster-b.de');
    expect(new Set(fake.aufrufe).size).toBe(fake.aufrufe.length);
  });

  it('probiert die zweite Umlaut-Variante (ü → u)', async () => {
    const f = firma('muster-c.de', [{ vorname: 'Hans', nachname: 'Müller', rolle: 'Einkaufsleiter' }]);
    const { d } = deps({ gueltig: ['hans.muller@muster-c.de'] });
    const erg = await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', d);
    expect(erg.treffer).toMatchObject({ email: 'hans.muller@muster-c.de', status: 'gueltig' });
  });

  it('findet Namen mit Zusatz („von der Heide“) über die Variante ohne Zusatz', async () => {
    const f = firma('muster-d.de', [{ vorname: 'Klaus', nachname: 'von der Heide', rolle: 'Leiter Beschaffung' }]);
    const { d } = deps({ gueltig: ['klaus.heide@muster-d.de'] });
    expect((await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', d)).treffer?.email).toBe('klaus.heide@muster-d.de');
  });

  it('Catch-All-Domain: keine Einzelprüfung, Ergebnis nur als „best guess, catch-all“ mit niedriger Konfidenz, nie als gültig', async () => {
    const f = firma('catchall.de', [{ vorname: 'Anna', nachname: 'Roth', rolle: 'Leiterin Einkauf' }]);
    const { d, fake } = deps({ catchAll: true });
    const erg = await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', d);
    expect(erg.treffer).toMatchObject({ email: 'anna.roth@catchall.de', status: 'catch_all_best_guess' });
    expect(erg.treffer!.konfidenz).toBeLessThanOrEqual(0.4);
    // Nur die Catch-All-Probe, kein Einzelkandidat
    expect(fake.aufrufe).toEqual(['zufallstest123@catchall.de']);
    const cp = m.db.getDb().select().from(m.db.schema.contactPoints).all().find((c) => c.companyId === f.id)!;
    expect(cp.status).toBe('catch_all_best_guess');
    expect(cp.verifiziertAm).toBeNull();
    expect(erg.protokoll.join(' ')).toMatch(/Catch-All/);
  });

  it('Domain ohne MX: alle Adressen ungültig, keine SMTP-Verbindung', async () => {
    const f = firma('kein-mx.de', [{ vorname: 'Anna', nachname: 'Roth', rolle: 'Leiterin Einkauf' }]);
    const { d, fake } = deps({ mx: 'kein_mx' });
    const erg = await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', d);
    expect(fake.aufrufe).toEqual([]);
    expect(erg.treffer).toBeNull();
    expect(erg.status).toBe('gefunden');
  });

  it('kein Kandidat gültig: generisches Postfach als letzter Fallback, klar als unpersönlich markiert', async () => {
    const f = firma('generisch.de', [{ vorname: 'Anna', nachname: 'Roth', rolle: 'Leiterin Einkauf' }]);
    const { d } = deps({ gueltig: ['einkauf@generisch.de'] });
    const erg = await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', d);
    expect(erg.treffer).toMatchObject({ email: 'einkauf@generisch.de', status: 'generisch' });
    expect(erg.treffer!.konfidenz).toBeLessThanOrEqual(0.5);
    expect(erg.person?.nachname).toBe('Roth');
  });

  it('auf der Website genanntes Postfach, das der Server nicht bestätigt, wird nur als „generisch, unverifiziert“ angeboten', async () => {
    const f = firma('generisch2.de', [{ vorname: 'Anna', nachname: 'Roth', rolle: 'Leiterin Einkauf' }], { firmaEmails: ['info@generisch2.de'] });
    const { d } = deps({ unbekannt: true });
    const erg = await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', d);
    expect(erg.treffer).toMatchObject({ email: 'info@generisch2.de', status: 'generisch_unverifiziert' });
    expect(erg.treffer!.konfidenz).toBeLessThanOrEqual(0.3);
  });

  it('nicht beobachtete generische Postfächer werden bei Catch-All nie geraten', async () => {
    const f = firma('generisch3.de', [], {});
    const { d } = deps({ catchAll: true });
    const erg = await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', d);
    expect(erg.treffer).toBeNull();
    expect(erg.status).toBe('rolle_offen');
  });

  it('keine Person zur Rolle: „Rolle offen“, erneute Anreicherung eingeplant (auch wenn ein generisches Postfach gefunden wurde)', async () => {
    const jetzt = 1_800_000_000_000;
    const f = firma('rolle-offen.de', [{ vorname: 'Tina', nachname: 'Klein', rolle: 'Sachbearbeiterin Buchhaltung' }], { firmaEmails: ['info@rolle-offen.de'] });
    const { d } = deps({ unbekannt: true }, { jetzt: () => jetzt });
    const erg = await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', d);
    expect(erg.status).toBe('rolle_offen');
    expect(erg.person).toBeNull();
    expect(erg.treffer?.status).toBe('generisch_unverifiziert');
    const e = m.db.getDb().select().from(m.db.schema.kontaktErgebnisse).all().find((x) => x.companyId === f.id)!;
    expect(e.status).toBe('rolle_offen');
    expect(e.naechsteAnreicherungAt!.getTime()).toBe(jetzt + 7 * 86400_000);
    expect(m.engine.faelligeWiederholungen(jetzt + 6 * 86400_000)).not.toContainEqual({ companyId: f.id, rolleKey: 'einkauf_leitung' });
    expect(m.engine.faelligeWiederholungen(jetzt + 8 * 86400_000)).toContainEqual({ companyId: f.id, rolleKey: 'einkauf_leitung' });
  });

  it('fehlt die Rolle, gilt die nächsthöhere (Geschäftsführer) als Fallback und ist so markiert, mit niedrigerer Konfidenz', async () => {
    const mitRolle = firma('fallback-a.de', [{ vorname: 'Anna', nachname: 'Roth', rolle: 'Leiterin Einkauf' }]);
    const ohneRolle = firma('fallback-b.de', [{ vorname: 'Hans', nachname: 'Berg', rolle: 'Geschäftsführer' }]);
    const exakt = await m.engine.fuehreKontaktEngineAus(mitRolle.id, 'einkauf_leitung', deps({ gueltig: ['anna.roth@fallback-a.de'] }).d);
    const fallback = await m.engine.fuehreKontaktEngineAus(ohneRolle.id, 'einkauf_leitung', deps({ gueltig: ['hans.berg@fallback-b.de'] }).d);
    expect(exakt.rollenTreffer).toBe('exakt');
    expect(fallback.rollenTreffer).toBe('fallback');
    expect(fallback.treffer!.konfidenz).toBeLessThan(exakt.treffer!.konfidenz);
  });

  it('bevorzugt die exakte Rolle vor dem Fallback, auch wenn der Geschäftsführer sicherer belegt ist', async () => {
    const f = firma('fallback-c.de', [
      { vorname: 'Hans', nachname: 'Berg', rolle: 'Geschäftsführer', quelle: 'offeneregister' },
      { vorname: 'Anna', nachname: 'Roth', rolle: 'Leiterin Einkauf' },
    ]);
    const erg = await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', deps({ gueltig: [] }).d);
    expect(erg.person?.nachname).toBe('Roth');
  });

  it('prüft dieselbe Adresse nie doppelt (Cache) und hält den Abstand je Zieldomain ein', async () => {
    const f = firma('cache.de', [{ vorname: 'Anna', nachname: 'Roth', rolle: 'Leiterin Einkauf' }]);
    const a = deps({ gueltig: ['anna.roth@cache.de'] });
    await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', a.d);
    const nachErstem = a.fake.aufrufe.length;
    await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', a.d);
    expect(a.fake.aufrufe.length).toBe(nachErstem);
    // Zwischen Catch-All-Probe und Kandidat liegt mindestens der Mindestabstand
    expect(a.wartezeiten.length).toBeGreaterThan(0);
    expect(a.wartezeiten.every((w) => w <= 2000)).toBe(true);
  });

  it('Verifizierung „unbekannt“ wird nach 24 Stunden erneut versucht, ein gültiges Ergebnis bleibt 30 Tage gültig', async () => {
    let zeit = Date.now();
    // Die Catch-All-Probe („zz@…“) wird abgelehnt, die Domain ist also keine Catch-All-Domain
    const nur = new m.ver.FakeVerifier((a) => (a.startsWith('zz@') ? 'ungueltig' : a.startsWith('u@') ? 'unbekannt' : 'gueltig'));
    const v2 = new m.ver.GedrosselterVerifier({ verifier: nur, mx: async () => 'ok', jetzt: () => zeit, warte: async () => undefined, zufall: () => 'zz', minAbstandMs: 0 });
    await v2.pruefeAdresse('u@zeit.de');
    await v2.pruefeAdresse('g@zeit.de');
    const n = nur.aufrufe.length;
    await v2.pruefeAdresse('u@zeit.de');
    await v2.pruefeAdresse('g@zeit.de');
    expect(nur.aufrufe.length).toBe(n);
    zeit += 25 * 3600_000;
    await v2.pruefeAdresse('u@zeit.de');
    await v2.pruefeAdresse('g@zeit.de');
    expect(nur.aufrufe.length).toBe(n + 1);
    zeit += 31 * 86400_000;
    await v2.pruefeAdresse('g@zeit.de');
    // Nach 30 Tagen gilt auch der Domain-Status (Catch-All-Probe) nicht mehr: Probe und Adresse werden neu geprüft
    expect(nur.aufrufe.length).toBe(n + 3);
  });

  it('Domain-Eigenschaften werden gemerkt (Catch-All-Probe nur einmal)', async () => {
    const f = firma('einmal.de', [{ vorname: 'Anna', nachname: 'Roth', rolle: 'Leiterin Einkauf' }]);
    const f2 = firma('einmal.de', [{ vorname: 'Ben', nachname: 'Roth', rolle: 'Leiter Einkauf' }]);
    const a = deps({ gueltig: ['anna.roth@einmal.de', 'ben.roth@einmal.de'] });
    await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', a.d);
    await m.engine.fuehreKontaktEngineAus(f2.id, 'einkauf_leitung', a.d);
    expect(a.fake.aufrufe.filter((x) => x.startsWith('zufallstest123@'))).toHaveLength(1);
  });

  it('ein ausgefallener Finder verhindert die anderen nicht; ohne Treffer und mit Fehler wird „fehler“ gemeldet (Queue wiederholt)', async () => {
    const f = firma('finder.de', [{ vorname: 'Anna', nachname: 'Roth', rolle: 'Leiterin Einkauf' }]);
    const kaputt = { name: 'kaputt', finde: async () => { throw new Error('Suche down'); } };
    const gut = await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', deps({ gueltig: ['anna.roth@finder.de'] }, { finder: [kaputt, new m.fin.WebsiteFinder()] }).d);
    expect(gut.treffer?.status).toBe('gueltig');
    expect(gut.fehler.join(' ')).toMatch(/Suche down/);
    const leer = firma('finder2.de', []);
    const schlecht = await m.engine.fuehreKontaktEngineAus(leer.id, 'einkauf_leitung', deps({}, { finder: [kaputt] }).d);
    expect(schlecht.status).toBe('fehler');
  });

  it('ohne bestätigte Domain meldet die Engine „keine_domain“', async () => {
    const id = m.db.getDb().insert(m.db.schema.companies).values({ name: 'Ohne Domain', nameNormalized: 'ohne domain' }).returning({ id: m.db.schema.companies.id }).get().id;
    expect((await m.engine.fuehreKontaktEngineAus(id, 'einkauf_leitung', deps({}).d)).status).toBe('keine_domain');
  });

  it('unbekannte Zielrolle und unbekannte Firma sind Fehler', async () => {
    await expect(m.engine.fuehreKontaktEngineAus(999_999, 'einkauf_leitung', deps({}).d)).rejects.toThrow(/existiert nicht/);
    const f = firma('rolle.de', []);
    await expect(m.engine.fuehreKontaktEngineAus(f.id, 'gibt_es_nicht', deps({}).d)).rejects.toThrow(/Zielrolle/);
  });

  it('Schritte sind austauschbar und umsortierbar (gemeinsames Interface)', async () => {
    const f = firma('schritte.de', [{ vorname: 'Anna', nachname: 'Roth', rolle: 'Leiterin Einkauf' }]);
    const aufgerufen: string[] = [];
    const spion = (s: import('./steps').ContactStep): import('./steps').ContactStep => ({ name: s.name, run: async (c) => { aufgerufen.push(s.name); await s.run(c); } });
    const { d } = deps({ gueltig: ['anna.roth@schritte.de'] });
    await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', d, { schritte: m.steps.STANDARD_SCHRITTE.map(spion) });
    // Nach dem Treffer in D endet die Kette: E läuft nicht mehr
    expect(aufgerufen).toEqual(['A:person-finden', 'B:muster-bestimmen', 'C:kandidaten-bilden', 'D:verifizieren']);
  });
});

// ---------------------------------------------------------------- Muster aus mehreren Belegen, Websuche nach @domain

describe('Muster-Lernen (Schritt B) aus mehreren Quellen', () => {
  it('mehrere Belege für dasselbe Muster erhöhen die Konfidenz und stellen es nach vorn; Websuche nach @domain liefert weitere Belege', async () => {
    const f = firma('lernen.de', [
      { vorname: 'Anna', nachname: 'Roth', rolle: 'Leiterin Einkauf' },
      { vorname: 'Hans', nachname: 'Berg', rolle: 'Geschäftsführer', email: 'hberg@lernen.de' },
      { vorname: 'Eva', nachname: 'Klein', rolle: 'Prokuristin', email: 'eklein@lernen.de' },
    ]);
    const { d, suche } = deps({ gueltig: ['aroth@lernen.de'] }, {});
    (suche as unknown as { antworten: unknown }).antworten = null;
    const mitSuche = new m.search.FakeSearchProvider(() => [{ titel: 'Kontakt', url: 'https://x.de', snippet: 'Schreiben Sie an tmueller@lernen.de oder info@lernen.de' }]);
    const erg = await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', { ...d, suche: mitSuche });
    expect(erg.treffer).toMatchObject({ email: 'aroth@lernen.de', muster: 'vnachname' });
    expect(erg.protokoll.join('\n')).toMatch(/primäres Muster vnachname \(2 Belege/);
    expect(mitSuche.anfragen).toContain('"@lernen.de"');
  });
});

// ---------------------------------------------------------------- Personen-Finder (Schritt A)

describe('Personensuche: Suche, Grounding, Berufsnetzwerke', () => {
  const jobanzeige = 'Testfirma Stellenanzeige: Ihre Ansprechpartnerin ist Anna Roth, Leiterin Einkauf. Bewerbungen an karriere@x.de. Außerdem: Thomas Neu, Leiter Beschaffung.';
  it('findet Personen in Treffern, ruft Berufsnetzwerke nie ab, verwirft Erfundenes und Treffer ohne Firmennennung', async () => {
    const f = firma('suche.de', []);
    const db = m.db.getDb();
    const name = db.select().from(m.db.schema.companies).all().find((c) => c.id === f.id)!.name;
    const abgerufen: string[] = [];
    const fetcher = {
      holeSeite: async (url: string) => {
        abgerufen.push(url);
        const text = url.includes('fremd') ? 'Eine Seite ohne Bezug zur Firma.' : `${name} ${jobanzeige}`;
        return { status: 'ok' as const, url, finaleUrl: url, html: `<html><body><p>${text}</p></body></html>`, rawDocumentId: 1, ausCache: false };
      },
    } as unknown as import('../crawl/fetcher').HoeflicherFetcher;
    const suche = new m.search.FakeSearchProvider((q) =>
      q.includes('linkedin')
        ? [{ titel: `Anna Roth - Leiterin Einkauf - ${name} | LinkedIn`, url: 'https://de.linkedin.com/in/anna-roth', snippet: `Leiterin Einkauf bei ${name}` }]
        : [
            { titel: 'Stellenanzeige', url: 'https://jobs.example.org/anzeige-1', snippet: '' },
            { titel: 'Fremde Seite', url: 'https://fremd.example.org/', snippet: 'ohne Bezug' },
          ],
    );
    const extraktion = new m.prov.FakeExtractionProvider((_s, text) =>
      text.includes('Anna Roth')
        ? { personen: [{ vorname: 'Anna', nachname: 'Roth', rolle: 'Leiterin Einkauf' }, { vorname: 'Thomas', nachname: 'Neu', rolle: 'Leiter Beschaffung' }, { vorname: 'Erfunden', nachname: 'Person', rolle: 'Leiter Einkauf' }] }
        : { personen: [{ vorname: 'Fremder', nachname: 'Mensch', rolle: 'Leiter Einkauf' }] },
    );
    const finder = new m.fin.SucheFinder([{ tag: 'stellenanzeige', vorlage: '{firma} Stellenanzeige {rolle}' }, { tag: 'netzwerk', vorlage: 'site:linkedin.com/in "{firma}" "{rolle}"' }]);
    const treffer = await finder.finde({ firma: { id: f.id, name, nameNormalized: `testfirma ${zaehler}`, ort: 'Stuttgart', domain: 'suche.de' }, rolleKey: 'einkauf_leitung', rollen: standardRollen, deps: { suche, fetcher, extraktion }, db });
    // Das Berufsnetzwerk wird nie abgerufen, nur die Trefferzeile ausgewertet
    expect(abgerufen.some((u) => u.includes('linkedin'))).toBe(false);
    const namen = treffer.map((t) => `${t.vorname} ${t.nachname}`);
    expect(namen).toContain('Anna Roth');
    expect(namen).toContain('Thomas Neu');
    expect(namen).not.toContain('Erfunden Person');
    expect(namen).not.toContain('Fremder Mensch');
    // Anna Roth: Seite (0,65) und LinkedIn-Snippet (0,5) sind zwei unabhängige Belege → zusammengeführte Konfidenz steigt
    const cluster = m.fin.fuehreTrefferZusammen(treffer).find((c) => c.nachname === 'Roth')!;
    expect(cluster.quellen.map((q) => q.typ).sort()).toEqual(['netzwerk', 'stellenanzeige']);
    expect(cluster.konfidenz).toBeGreaterThan(0.65);
    expect(cluster.konfidenz).toBeLessThanOrEqual(0.97);
    // Suchvorlagen wurden mit Rolle, Firma eingesetzt
    expect(suche.anfragen[0]).toBe(`${name} Stellenanzeige Einkaufsleiter`);
  });

  it('ganze Engine: Person aus der Suche, verifizierte E-Mail, Fundstellen als Beobachtungen gespeichert', async () => {
    const f = firma('suche2.de', []);
    const db = m.db.getDb();
    const name = db.select().from(m.db.schema.companies).all().find((c) => c.id === f.id)!.name;
    const fetcher = { holeSeite: async (url: string) => ({ status: 'ok' as const, url, finaleUrl: url, html: `<p>${name}: Anna Roth, Leiterin Einkauf</p>`, rawDocumentId: 1, ausCache: false }) } as unknown as import('../crawl/fetcher').HoeflicherFetcher;
    const suche = new m.search.FakeSearchProvider((q) => (q.startsWith('"@') ? [] : [{ titel: 'Anzeige', url: 'https://portal.example.org/a', snippet: '' }]));
    const extraktion = new m.prov.FakeExtractionProvider(() => ({ personen: [{ vorname: 'Anna', nachname: 'Roth', rolle: 'Leiterin Einkauf' }] }));
    const { d } = deps({ gueltig: ['anna.roth@suche2.de'] }, { suche, fetcher, extraktion, finder: undefined });
    const erg = await m.engine.fuehreKontaktEngineAus(f.id, 'einkauf_leitung', d);
    expect(erg.treffer).toMatchObject({ email: 'anna.roth@suche2.de', status: 'gueltig' });
    expect(erg.quellen).toContain('https://portal.example.org/a');
    const obs = db.select().from(m.db.schema.attributeObservations).all().filter((o) => o.entityType === 'person' && o.entityId === erg.personId && o.feld === 'person');
    expect(obs.some((o) => o.quelle.startsWith('suche:'))).toBe(true);
  });
});

// ---------------------------------------------------------------- Reacher

describe('Reacher-Anbindung', () => {
  const antwort = (reachable: string, smtp: Record<string, unknown> = {}, mx: Record<string, unknown> = { accepts_mail: true }) => ({ is_reachable: reachable, mx, smtp: { can_connect_smtp: true, is_deliverable: true, is_catch_all: false, is_disabled: false, has_full_inbox: false, ...smtp } });
  it('übersetzt die Antworten des Dienstes', () => {
    expect(mapReacherAntwort(antwort('safe')).status).toBe('gueltig');
    expect(mapReacherAntwort(antwort('invalid', { is_deliverable: false })).status).toBe('ungueltig');
    expect(mapReacherAntwort(antwort('risky', { is_catch_all: true })).status).toBe('catch_all');
    expect(mapReacherAntwort(antwort('risky')).status).toBe('risky');
    expect(mapReacherAntwort(antwort('unknown')).status).toBe('unbekannt');
    expect(mapReacherAntwort(antwort('safe', {}, { accepts_mail: false })).status).toBe('ungueltig');
    // „safe“ ohne bestätigte Zustellbarkeit ist nie „gültig“
    expect(mapReacherAntwort(antwort('safe', { is_deliverable: false })).status).toBe('unbekannt');
    expect(mapReacherAntwort('kaputt').status).toBe('unbekannt');
    expect(mapReacherAntwort(null).status).toBe('unbekannt');
  });
  it('ruft den Dienst per POST auf und liefert bei Fehlern „unbekannt“, nie „gültig“', async () => {
    let body = '';
    let kopf: Headers | undefined;
    const ok = (async (_u: string | URL | Request, init?: RequestInit) => {
      body = String(init?.body);
      kopf = new Headers(init?.headers);
      return new Response(JSON.stringify(antwort('safe')), { status: 200 });
    }) as typeof fetch;
    expect((await new ReacherVerifier({ url: 'https://reacher.example.org/', apiKey: 'geheim', f: ok }).pruefe('a@b.de')).status).toBe('gueltig');
    expect(JSON.parse(body)).toEqual({ to_email: 'a@b.de' });
    expect(kopf?.get('authorization')).toBe('geheim');
    expect((await new ReacherVerifier({ url: 'https://r.example.org', f: (async () => new Response('', { status: 500 })) as typeof fetch }).pruefe('a@b.de')).status).toBe('unbekannt');
    expect((await new ReacherVerifier({ url: 'https://r.example.org', f: (async () => { throw new Error('down'); }) as typeof fetch }).pruefe('a@b.de')).status).toBe('unbekannt');
    expect((await new ReacherVerifier({ url: '', f: ok }).pruefe('a@b.de')).details).toMatchObject({ grund: expect.stringMatching(/REACHER_URL/) });
  });
});

// ---------------------------------------------------------------- Telefon

describe('Telefon aus Impressum und Webseite', () => {
  it('übernimmt Zentrale und Durchwahl und Mobilnummern nur von der Webseite oder aus dem Register, nie Fax oder fremde Quellen', () => {
    const f = firma('tel.de', [], {
      telefone: [
        { e164: '+49711123456' + '7', art: 'zentrale' },
        { e164: '+497111234568', art: 'fax' },
        { e164: '+491712345678', art: 'mobil' },
        { e164: '+491709999999', art: 'mobil', quelle: 'adressbuch' },
      ],
    });
    const n = m.tel.uebernehmeTelefone(f.id, m.db.getDb());
    expect(n).toBe(2);
    const cps = m.db.getDb().select().from(m.db.schema.contactPoints).all().filter((c) => c.companyId === f.id && c.typ === 'telefon');
    expect(cps.map((c) => [c.wert, c.art]).sort()).toEqual([['+491712345678', 'mobil'], ['+497111234567', 'zentrale']]);
    expect(cps.every((c) => c.status === 'oeffentlich')).toBe(true);
    // erneuter Aufruf legt nichts doppelt an
    m.tel.uebernehmeTelefone(f.id, m.db.getDb());
    expect(m.db.getDb().select().from(m.db.schema.contactPoints).all().filter((c) => c.companyId === f.id && c.typ === 'telefon')).toHaveLength(2);
  });
});
