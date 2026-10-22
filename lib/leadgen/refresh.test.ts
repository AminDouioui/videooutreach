import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { BundesanzeigerConnector, BundesanzeigerDeaktiviert, normalisiereBundesanzeiger, parseJahresabschluss } from './connectors/bundesanzeiger';
import { parseBekanntmachung } from './connectors/bekanntmachungen';
import { vergleicheRegisterSaetze } from './ereignisse';
import type { NormalisierterSatz } from './types';

const TAG = 86_400_000;

describe('Jahresabschluss lesen (Mitarbeiterzahl, Größenklasse § 267 HGB, Umsatz)', () => {
  it.each([
    ['Im Geschäftsjahr waren durchschnittlich 231 Arbeitnehmer beschäftigt.', 231],
    ['Die durchschnittliche Zahl der während des Geschäftsjahres beschäftigten Arbeitnehmer betrug: 1.250', 1250],
    ['Mitarbeiter im Jahresdurchschnitt: 87', 87],
    ['Anzahl der Arbeitnehmer im Jahresdurchschnitt 412 (Vorjahr 398)', 412],
  ])('%s', (text, zahl) => {
    expect(parseJahresabschluss(text).mitarbeiterZahl).toBe(zahl);
  });
  it('liest Größenklasse, Umsatz und Stichtag; rät nichts', () => {
    const j = parseJahresabschluss('Jahresabschluss zum 31.12.2023. Mittelgroße Kapitalgesellschaft im Sinne des § 267 Abs. 2 HGB. Umsatzerlöse 28.450 TEUR.');
    expect(j).toMatchObject({ klasse: 'hgb_mittel', umsatzEur: 28_450_000, stichtag: Date.UTC(2023, 11, 31) });
    expect(j.mitarbeiterZahl).toBeNull();
    expect(parseJahresabschluss('Kleine Kapitalgesellschaft nach § 267 Abs. 1 HGB').klasse).toBe('hgb_klein');
    expect(parseJahresabschluss('Große Kapitalgesellschaft im Sinne des § 267 Abs. 3 HGB').klasse).toBe('hgb_gross');
    expect(parseJahresabschluss('Umsatzerlöse 12,5 Mio. EUR').umsatzEur).toBe(12_500_000);
    expect(parseJahresabschluss('Nichts Verwertbares')).toEqual({ mitarbeiterZahl: null, klasse: null, umsatzEur: null, stichtag: null });
    // unplausible Zahlen werden verworfen
    expect(parseJahresabschluss('durchschnittlich 0 Arbeitnehmer').mitarbeiterZahl).toBeNull();
  });
  it('normalisiert das Rohdokument: Register zum Zuordnen, Mitarbeiterangabe mit Bilanzstichtag; ohne Angaben unbrauchbar', () => {
    const doc = { quelle: 'bundesanzeiger', referenz: 'x', inhalt: JSON.stringify({ name: 'Beispiel Werkzeugbau GmbH', registergericht: 'Stuttgart', registerart: 'HRB', registernummer: '100001', stichtag: '2023-12-31', text: 'durchschnittlich 231 Arbeitnehmer' }) };
    const s = normalisiereBundesanzeiger(doc)!;
    expect(s).toMatchObject({ name: 'Beispiel Werkzeugbau', rechtsform: 'GmbH', registernummer: '100001', mitarbeiter: { zahl: 231, klasse: null, stichtag: Date.UTC(2023, 11, 31) } });
    expect(normalisiereBundesanzeiger({ ...doc, inhalt: JSON.stringify({ name: 'X GmbH', text: 'nichts' }) })).toBeNull();
    expect(normalisiereBundesanzeiger({ ...doc, inhalt: 'kaputt' })).toBeNull();
  });
  it('der Abruf im Netz ist standardmäßig aus, gedrosselt und ohne eingebauten Scraper', async () => {
    const alle = async (c: BundesanzeigerConnector) => {
      const l: string[] = [];
      for await (const d of c.fetch()) l.push(d.referenz);
      return l;
    };
    await expect(alle(new BundesanzeigerConnector({ firmen: [{ name: 'A' }], abruf: async () => [] }))).rejects.toBeInstanceOf(BundesanzeigerDeaktiviert);
    await expect(alle(new BundesanzeigerConnector({ firmen: [{ name: 'A' }], aktiv: true }))).rejects.toThrow(/Kein Abruf/);
    const warten: number[] = [];
    let zeit = 1_000_000_000_000;
    const c = new BundesanzeigerConnector({ firmen: [{ name: 'A' }, { name: 'B' }], aktiv: true, abruf: async (f) => [{ name: f.name, registernummer: '1', registerart: 'HRB', registergericht: 'X', stichtag: '2023-12-31', text: 'durchschnittlich 50 Arbeitnehmer' }], jetzt: () => zeit, warte: async (ms) => { warten.push(ms); zeit += ms; } });
    expect(await alle(c)).toHaveLength(2);
    expect(warten).toEqual([60_000]);
  });
});

describe('Datenstand der Registerquelle', () => {
  it('liest retrieved_at als Alter der Angaben, ignoriert ungültige und zukünftige Werte', async () => {
    const { normalisiereOffeneRegister } = await import('./connectors/offeneregister');
    const doc = (retrieved: unknown) => ({ quelle: 'offeneregister', referenz: 'x', inhalt: JSON.stringify({ company_number: 'K1_HRB1', name: 'A GmbH', retrieved_at: retrieved }) });
    expect(normalisiereOffeneRegister(doc('2018-11-01T10:00:00'))!.datenStand).toBe(Date.parse('2018-11-01T10:00:00'));
    expect(normalisiereOffeneRegister(doc('kein datum'))!.datenStand).toBeNull();
    expect(normalisiereOffeneRegister(doc('2999-01-01'))!.datenStand).toBeNull();
    expect(normalisiereOffeneRegister(doc(undefined))!.datenStand).toBeNull();
  });
});

describe('Bekanntmachungen lesen', () => {
  it('erkennt Bestellung, Ausscheiden und Neueintragung', () => {
    const p = parseBekanntmachung('Veränderungen. Bestellt: Geschäftsführer: Weber, Katrin, Stuttgart, *03.04.1980, einzelvertretungsberechtigt. Nicht mehr Geschäftsführer: Müller, Hans, Stuttgart.');
    expect(p.bestellt).toEqual([{ name: 'Katrin Weber', rolle: 'Geschäftsführer' }]);
    expect(p.ausgeschieden).toEqual([{ name: 'Hans Müller', rolle: 'Geschäftsführer' }]);
    expect(p.neueintragung).toBe(false);
    expect(parseBekanntmachung('Neueintragung. Geschäftsführer: Keller, Jonas, Stuttgart.').neueintragung).toBe(true);
    expect(parseBekanntmachung('Ausgeschieden: Prokurist: Lang, Eva, Düsseldorf.').ausgeschieden).toEqual([{ name: 'Eva Lang', rolle: 'Prokurist' }]);
    expect(parseBekanntmachung('Sitz verlegt nach München.')).toEqual({ neueintragung: false, bestellt: [], ausgeschieden: [] });
  });
});

describe('Vergleich zweier Registerstände', () => {
  const satz = (personen: Array<[string, string, string]>): NormalisierterSatz => ({
    quelle: 'offeneregister', referenz: 'r', name: 'Firma', rechtsform: null, nameNormalized: 'firma', registerart: null, registernummer: null, registergericht: null, sitz: null, adresse: null, status: null,
    personen: personen.map(([v, n, rolle]) => ({ vorname: v, nachname: n, titel: [], rolle: rolle as 'geschaeftsfuehrer', rolleOriginal: rolle })),
  });
  it('erkennt Wechsel, neuen und ausgeschiedenen Geschäftsführer; Prokuristen zählen nicht', () => {
    const alt = satz([['Hans', 'Müller', 'geschaeftsfuehrer'], ['Eva', 'Lang', 'prokurist']]);
    expect(vergleicheRegisterSaetze(alt, satz([['Katrin', 'Weber', 'geschaeftsfuehrer'], ['Eva', 'Lang', 'prokurist']]))[0]).toMatchObject({ typ: 'gf_wechsel', daten: { neu: [{ name: 'Katrin Weber' }], alt: [{ name: 'Hans Müller' }] } });
    expect(vergleicheRegisterSaetze(alt, satz([['Hans', 'Müller', 'geschaeftsfuehrer'], ['Katrin', 'Weber', 'geschaeftsfuehrer']]))[0].typ).toBe('gf_neu');
    expect(vergleicheRegisterSaetze(alt, satz([['Eva', 'Lang', 'prokurist']]))[0].typ).toBe('gf_ausgeschieden');
    expect(vergleicheRegisterSaetze(alt, satz([['Hans', 'Müller', 'geschaeftsfuehrer'], ['Eva', 'Lang', 'prokurist'], ['Neu', 'Prokurist', 'prokurist']]))).toEqual([]);
    // Schreibweise („Mueller“) ist kein Wechsel
    expect(vergleicheRegisterSaetze(alt, satz([['Hans', 'Mueller', 'geschaeftsfuehrer'], ['Eva', 'Lang', 'prokurist']]))).toEqual([]);
  });
});

// ---------------------------------------------------------------- Datenbank

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-refresh-'));
Object.assign(process.env, { DATA_DIR: dir, ADMIN_PASSWORD: 'x', SESSION_SECRET: 'x'.repeat(32), ENCRYPTION_KEY: '0'.repeat(64), IP_HASH_SALT: 's' });
const FIX = (n: string) => path.resolve(process.cwd(), 'test/fixtures/leadgen', n);
const SEED = FIX('offeneregister-beispiel.jsonl');

type Mod = {
  db: typeof import('@/lib/db');
  ingest: typeof import('./ingest');
  oreg: typeof import('./connectors/offeneregister');
  ba: typeof import('./connectors/bundesanzeiger');
  bm: typeof import('./connectors/bekanntmachungen');
  res: typeof import('./resolve/resolve');
  ereig: typeof import('./ereignisse');
  gold: typeof import('./golden/rebuild');
  refresh: typeof import('./refresh');
  fin: typeof import('./contacts/finder');
  stufen: typeof import('./stufen');
  lauf: typeof import('./lauf');
  settings: typeof import('@/lib/settings');
  ver: typeof import('./contacts/verifier');
  prov: typeof import('./extract/provider');
  search: typeof import('./search/provider');
  rollen: typeof import('./contacts/rollen');
};
let m: Mod;
beforeAll(async () => {
  m = {
    db: await import('@/lib/db'), ingest: await import('./ingest'), oreg: await import('./connectors/offeneregister'), ba: await import('./connectors/bundesanzeiger'), bm: await import('./connectors/bekanntmachungen'),
    res: await import('./resolve/resolve'), ereig: await import('./ereignisse'), gold: await import('./golden/rebuild'), refresh: await import('./refresh'), fin: await import('./contacts/finder'),
    stufen: await import('./stufen'), lauf: await import('./lauf'), settings: await import('@/lib/settings'), ver: await import('./contacts/verifier'), prov: await import('./extract/provider'),
    search: await import('./search/provider'), rollen: await import('./contacts/rollen'),
  };
  m.db.getDb();
});
const db0 = () => m.db.getDb();
const firma = (name: string) => m.db.getDb().select().from(m.db.schema.companies).all().find((c) => c.name === name)!;

describe('Change Detection beim Import (Geschäftsführerwechsel, Neueintragung)', () => {
  it('der erste Import ist die Basislinie: keine Ereignisse', async () => {
    const erg = await m.ingest.ingestQuelle(new m.oreg.OffeneRegisterConnector({ datei: SEED }));
    expect(erg).toMatchObject({ neu: 20, ereignisse: 0 });
    m.res.loeseEntitaetenAuf();
  });

  it('ein neuer Stand mit anderem Geschäftsführer ergibt „Geschäftsführerwechsel“, eine neue Firma „Neueintragung“; Wiederholung doppelt nichts', async () => {
    const zeilen = fs.readFileSync(SEED, 'utf8').trim().split('\n').filter((l) => l.startsWith('{"company_number"'));
    const alt = JSON.parse(zeilen[0]);
    expect(alt.officers[0].name).toBe('Müller, Hans');
    alt.officers = [{ name: 'Weber, Katrin', position: 'Geschäftsführer', type: 'person' }];
    const neu = { company_number: 'K9999R_HRB777777', name: 'Neu Gegründete Werkzeug GmbH', current_status: 'currently registered', registered_address: 'Weg 1, 70173 Stuttgart', all_attributes: { native_company_number: 'Stuttgart HRB 777777', registrar: 'Stuttgart', _registerArt: 'HRB', _registerNummer: '777777', registered_office: 'Stuttgart', federal_state: 'Baden-Württemberg' }, officers: [{ name: 'Keller, Jonas', position: 'Geschäftsführer', type: 'person' }] };
    const datei = path.join(dir, 'update.jsonl');
    fs.writeFileSync(datei, [JSON.stringify(alt), JSON.stringify(neu)].join('\n') + '\n');
    const erg = await m.ingest.ingestQuelle(new m.oreg.OffeneRegisterConnector({ datei }));
    expect(erg).toMatchObject({ neu: 2, ereignisse: 2 });
    // Zweiter Durchlauf mit demselben Inhalt: nichts Neues
    expect(await m.ingest.ingestQuelle(new m.oreg.OffeneRegisterConnector({ datei }))).toMatchObject({ neu: 0, ereignisse: 0 });

    m.res.loeseEntitaetenAuf();
    const ev = m.ereig.ladeEreignisse({ nurNeue: true });
    expect(ev.map((e) => e.typ).sort()).toEqual(['gf_wechsel', 'neueintragung']);
    const wechsel = ev.find((e) => e.typ === 'gf_wechsel')!;
    // Die Firma wird über die Entity Resolution zugeordnet; Name der Firma steht in der Anzeige
    expect(wechsel).toMatchObject({ companyId: firma('Beispiel Werkzeugbau').id, firma: 'Beispiel Werkzeugbau GmbH', daten: { neu: [{ name: 'Katrin Weber' }], alt: [{ name: 'Hans Müller' }] } });
    expect(ev.find((e) => e.typ === 'neueintragung')!.firma).toBe('Neu Gegründete Werkzeug GmbH');
    // Als Outreach-Trigger bearbeitet: verschwindet aus der Liste der neuen Ereignisse
    expect(m.ereig.markiereEreignis(wechsel.id, 'gesehen')).toBe(true);
    expect(m.ereig.ladeEreignisse({ nurNeue: true }).map((e) => e.typ)).toEqual(['neueintragung']);
    expect(m.ereig.ladeEreignisse({}).length).toBe(2);
  });
});

describe('Bundesanzeiger: Mitarbeiterzahl und Größenklasse aus Jahresabschlüssen', () => {
  it('importiert Jahresabschlüsse aus der Datei, ordnet sie über die Registernummer zu und führt den Golden Record nach', async () => {
    const erg = await m.ingest.ingestQuelle(new m.ba.JahresabschlussDateiConnector(FIX('jahresabschluesse-beispiel.jsonl')));
    // 4 lesbare Zeilen (eine defekte übersprungen), eine ohne verwertbare Angaben
    expect(erg).toMatchObject({ dokumente: 4, neu: 4, unbrauchbar: 1 });
    const r = m.res.loeseEntitaetenAuf();
    expect(r.zusammengefuehrt).toBe(3);
    expect(m.res.ladeResolutionKennzahlen().firmen).toBe(21);

    const beispiel = firma('Beispiel Werkzeugbau');
    // vorher gab die Webseite eine Schätzung, der Jahresabschluss (exakt) gewinnt trotz höheren Alters
    m.db.getDb().insert(m.db.schema.attributeObservations).values({ entityType: 'company', entityId: beispiel.id, feld: 'mitarbeiter', wert: { zahl: 180 }, quelle: 'web', konfidenz: 0.5, typ: 'schaetzung' }).run();
    m.gold.berechneGolden(beispiel.id, { jetzt: Date.UTC(2026, 9, 22) });
    const nach = m.db.getDb().select().from(m.db.schema.companies).all().find((c) => c.id === beispiel.id)!;
    // Neuester Jahresabschluss (2023) schlägt den älteren (2021) bei gleicher Quelle
    expect(nach).toMatchObject({ mitarbeiterZahl: 231, mitarbeiterTyp: 'exakt', mitarbeiterKlasse: '100-249' });
    const h = (nach.herkunft as Record<string, { quelle: string; typ: string; beobachtetAm: number; konfidenz: number; konfidenzRoh: number }>).mitarbeiter;
    expect(h).toMatchObject({ quelle: 'bundesanzeiger', typ: 'exakt', beobachtetAm: Date.UTC(2023, 11, 31) });
    // Das Alter der Angabe ist der Bilanzstichtag (nicht der Importzeitpunkt): die Konfidenz ist bereits zerfallen
    expect(h.konfidenz).toBeLessThan(h.konfidenzRoh);

    // Nur Größenklasse (mittelgroß nach § 267 HGB): Klasse ohne Zahl, mit Typ „klasse“
    const muster = firma('Muster Formenbau');
    m.gold.berechneGolden(muster.id, { jetzt: Date.UTC(2026, 9, 22) });
    expect(m.db.getDb().select().from(m.db.schema.companies).all().find((c) => c.id === muster.id)).toMatchObject({ mitarbeiterZahl: null, mitarbeiterTyp: 'klasse', mitarbeiterKlasse: 'hgb_mittel' });
  });
});

describe('Bekanntmachungen: Ereignisse und Personenpflege', () => {
  it('speichert Ereignisse, führt neue Geschäftsführer nach und markiert ausgeschiedene; wirkt auf Finder und Golden Record', async () => {
    const beispiel = firma('Beispiel Werkzeugbau');
    // Der Registerseed ist alt (Datenstand 2019), die Bekanntmachung neuer: so liefert der echte Dump seine Beobachtungen (retrieved_at)
    db0().run(sql`update attribute_observations set beobachtet_am = ${Date.UTC(2019, 0, 15)} where quelle = 'offeneregister'`);
    const erg = await m.bm.verarbeiteBekanntmachungen(new m.bm.BekanntmachungenDateiConnector(FIX('bekanntmachungen-beispiel.jsonl')), m.db.getDb(), Date.UTC(2026, 9, 22));
    // Wechsel bei Beispiel, Neueintragung einer noch unbekannten Firma; die reine Prokura-Änderung ergibt kein Ereignis
    expect(erg).toMatchObject({ dokumente: 3, neu: 3, ereignisse: 2, unbekannteFirmen: 1 });
    const db = m.db.getDb();
    const personen = db.select().from(m.db.schema.persons).all().filter((p) => p.companyId === beispiel.id);
    expect(personen.find((p) => p.nachname === 'Müller')).toMatchObject({ rolle: 'ausgeschieden' });
    expect(personen.find((p) => p.nachname === 'Weber')).toBeTruthy();
    // Wiederholung doppelt nichts
    expect(await m.bm.verarbeiteBekanntmachungen(new m.bm.BekanntmachungenDateiConnector(FIX('bekanntmachungen-beispiel.jsonl')), db)).toMatchObject({ neu: 0, ereignisse: 0 });

    // Der Finder liefert den ausgeschiedenen Geschäftsführer nicht mehr, wohl aber die neue Geschäftsführerin
    const treffer = await new m.fin.WebsiteFinder().finde({ firma: { id: beispiel.id, name: beispiel.name, nameNormalized: beispiel.nameNormalized, ort: null, domain: null }, rolleKey: 'geschaeftsfuehrung', rollen: m.rollen.standardRollen, deps: {} as never, db });
    expect(treffer.some((t) => t.nachname === 'Müller')).toBe(false);
    expect(treffer.some((t) => t.nachname === 'Weber' && t.rolle.toLowerCase().includes('gesch'))).toBe(true);
    // Auch nach einer Neuberechnung bleibt es so (Golden Record aus Beobachtungen)
    m.gold.berechneGolden(beispiel.id);
    expect(db.select().from(m.db.schema.persons).all().find((p) => p.id === personen.find((x) => x.nachname === 'Müller')!.id)).toMatchObject({ rolle: 'ausgeschieden' });
    // Ereignisse im Outreach-Trigger-Feed
    const feed = m.ereig.ladeEreignisse({ nurNeue: true });
    expect(feed.map((e) => e.typ)).toEqual(expect.arrayContaining(['gf_wechsel']));
  });
});

// ---------------------------------------------------------------- Auffrischung

describe('Auffrischung: Intervalle, Planung, Ausführung', () => {
  const JETZT = Date.UTC(2026, 9, 22, 12);
  function aktiveFirma(name: string, opt: { verifiziertVorTagen?: number; extraktionVorTagen?: number; status?: 'gefunden' | 'rolle_offen'; offenFaelligVorTagen?: number; domain?: boolean; lead?: boolean } = {}) {
    const db = m.db.getDb();
    const id = db.insert(m.db.schema.companies).values({ name, nameNormalized: name.toLowerCase(), domain: opt.domain === false ? null : `${name.toLowerCase().replace(/ /g, '')}.de` }).returning({ id: m.db.schema.companies.id }).get().id;
    if (opt.domain !== false) db.insert(m.db.schema.domains).values({ companyId: id, domain: `${name.toLowerCase().replace(/ /g, '')}.de`, verifiziert: true }).run();
    if (opt.lead !== false) db.insert(m.db.schema.leads).values({ campaignId: 1, firma: name, email: `x@${name.toLowerCase().replace(/ /g, '')}.de`, slug: `s-${id}`, leadgenCompanyId: id }).run();
    const cp = db.insert(m.db.schema.contactPoints).values({ companyId: id, typ: 'email', wert: `x@${name.toLowerCase().replace(/ /g, '')}.de`, status: 'gueltig', verifiziertAm: new Date(JETZT - (opt.verifiziertVorTagen ?? 1) * TAG) }).returning({ id: m.db.schema.contactPoints.id }).get().id;
    db.insert(m.db.schema.kontaktErgebnisse).values({ companyId: id, rolleKey: 'einkauf_leitung', status: opt.status ?? 'gefunden', contactPointId: cp, konfidenz: 0.8, updatedAt: new Date(JETZT - (opt.verifiziertVorTagen ?? 1) * TAG), naechsteAnreicherungAt: opt.offenFaelligVorTagen !== undefined ? new Date(JETZT - opt.offenFaelligVorTagen * TAG) : null }).run();
    if (opt.extraktionVorTagen !== undefined) db.insert(m.db.schema.extractionRuns).values({ companyId: id, provider: 'fake', createdAt: new Date(JETZT - opt.extraktionVorTagen * TAG) }).run();
    return id;
  }

  beforeAll(() => {
    // Kampagne für die Leads
    m.db.getDb().insert(m.db.schema.campaigns).values({ name: 'K', emailSubjectTemplate: 's', emailBodyTemplate: 'b', ctaUrl: 'https://example.org' }).run();
  });

  it('fällig sind: E-Mail-Status nach 30 Tagen, Webseite nach 90 Tagen, offene Rollen zum geplanten Termin; nur Firmen in Kampagnen', () => {
    const frisch = aktiveFirma('Frisch GmbH', { verifiziertVorTagen: 29, extraktionVorTagen: 10 });
    const email = aktiveFirma('Email Alt GmbH', { verifiziertVorTagen: 31 });
    const web = aktiveFirma('Web Alt GmbH', { verifiziertVorTagen: 5, extraktionVorTagen: 91 });
    const offen = aktiveFirma('Offen GmbH', { status: 'rolle_offen', offenFaelligVorTagen: 1, lead: false });
    const offenNoch = aktiveFirma('Offen Noch GmbH', { status: 'rolle_offen', offenFaelligVorTagen: -3, lead: false });
    const ohneLead = aktiveFirma('Ohne Lead GmbH', { verifiziertVorTagen: 99, lead: false });
    const f = m.refresh.faelligeFirmen({ jetzt: JETZT });
    const gruende = Object.fromEntries(f.map((x) => [x.companyId, x.grund]));
    expect(gruende[email]).toBe('email');
    expect(gruende[web]).toBe('web');
    expect(gruende[offen]).toBe('rolle_offen');
    expect(gruende[frisch]).toBeUndefined();
    expect(gruende[offenNoch]).toBeUndefined();
    expect(gruende[ohneLead]).toBeUndefined();
  });

  it('Intervalle sind konfigurierbar, die Zahl je Planung begrenzt', () => {
    m.settings.setSetting('leadgen_intervalle', JSON.stringify({ emailStatusTage: 60, webTage: 200, maxProPlanung: 1 }));
    expect(m.refresh.ladeIntervalle()).toEqual({ emailStatusTage: 60, webTage: 200, maxProPlanung: 1 });
    const f = m.refresh.faelligeFirmen({ jetzt: JETZT });
    expect(f).toHaveLength(1);
    expect(f[0].grund).toBe('rolle_offen');
    m.settings.setSetting('leadgen_intervalle', 'kaputt');
    expect(m.refresh.ladeIntervalle()).toEqual(m.refresh.STANDARD_INTERVALLE);
    m.settings.deleteSetting('leadgen_intervalle');
  });

  it('plant einen Auffrischungslauf mit passender Startstufe je Grund und führt die Re-Verifizierung aus', async () => {
    const f = m.refresh.faelligeFirmen({ jetzt: JETZT });
    const email = f.find((x) => x.grund === 'email')!;
    const web = f.find((x) => x.grund === 'web')!;
    const runs = m.refresh.starteAuffrischung([email, web]);
    expect(runs).toHaveLength(1);
    const db = m.db.getDb();
    const jobs = db.select().from(m.db.schema.pipelineJobs).all().filter((j) => j.runId === runs[0]);
    expect(jobs.find((j) => j.entityId === email.companyId)!.stufe).toBe('kontakt');
    expect(jobs.find((j) => j.entityId === web.companyId)!.stufe).toBe('crawl');
    const run = m.lauf.ladeLaufStatus(runs[0])!;
    expect(run.filter.refresh).toBe(true);
    expect(run.firmen).toBe(2);

    // Die Kontakt-Engine prüft die Adresse erneut; der Zeitstempel wird aktualisiert (Fake-Verifizierung)
    const fake = new m.ver.FakeVerifier((a) => (a === `x@emailaltgmbh.de` ? 'gueltig' : 'ungueltig'));
    const verifier = new m.ver.GedrosselterVerifier({ verifier: fake, mx: async () => 'ok', minAbstandMs: 0, zufall: () => 'zz' });
    const deps = () => ({ suche: new m.search.FakeSearchProvider(() => []), fetcher: { holeSeite: async (url: string) => ({ status: 'fehler' as const, url, fehler: 'offline' }) } as never, extraktion: new m.prov.FakeExtractionProvider(() => ({ personen: [], telefone: [] })), verifier, rollen: m.rollen.standardRollen, runId: runs[0], finder: [] });
    let t = Date.now();
    while (await m.stufen.verarbeiteNaechstenJob(deps as never, { jetzt: (t += 3 * 3600_000) })) { /* weiter */ }
    const lauf = m.lauf.ladeLaufStatus(runs[0])!;
    expect(lauf.stufen.find((s) => s.stufe === 'kontakt')!.fertig).toBeGreaterThanOrEqual(1);
    expect(lauf.status).toBe('fertig');
  });

  it('Zeitplan: plant höchstens stündlich, nie parallel zu einer laufenden Auffrischung, abschaltbar; Golden Record täglich neu', () => {
    const db = m.db.getDb();
    // Laufende Auffrischung aus dem vorigen Test ist fertig: neuer Tick plant
    for (const k of ['leadgen_refresh_zuletzt', 'leadgen_golden_zuletzt'] as const) m.settings.deleteSetting(k);
    const t0 = m.refresh.zeitplanTick({ jetzt: JETZT });
    expect(t0.golden).toBe(true);
    expect(t0.geplant).toBeGreaterThan(0);
    // Innerhalb der Stunde: nichts, auch kein Golden-Neuaufbau
    expect(m.refresh.zeitplanTick({ jetzt: JETZT + 600_000 })).toEqual({ geplant: 0, golden: false });
    // Nach einer Stunde, aber der geplante Lauf läuft noch: nicht parallel
    expect(m.refresh.zeitplanTick({ jetzt: JETZT + 3700_000 })).toEqual({ geplant: 0, golden: false });
    // Abgeschaltet: keine Planung, Golden-Neuaufbau läuft trotzdem täglich
    db.update(m.db.schema.pipelineRuns).set({ status: 'fertig' }).where(eq(m.db.schema.pipelineRuns.status, 'laeuft')).run();
    m.settings.setSetting('leadgen_refresh_aktiv', '0');
    const aus = m.refresh.zeitplanTick({ jetzt: JETZT + 2 * TAG });
    expect(aus).toEqual({ geplant: 0, golden: true });
    m.settings.deleteSetting('leadgen_refresh_aktiv');
  });

  it('Kennzahl am Ende: Firmen, mit Geschäftsführer, mit verifizierter E-Mail', () => {
    const k = m.ingest.ladeKennzahlen();
    expect(k.firmen).toBeGreaterThanOrEqual(21);
    expect(k.mitGeschaeftsfuehrer).toBeGreaterThanOrEqual(20);
  });
});
