import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-leadgen-'));
Object.assign(process.env, { DATA_DIR: dir, ADMIN_PASSWORD: 'x', SESSION_SECRET: 'x'.repeat(32), ENCRYPTION_KEY: '0'.repeat(64), IP_HASH_SALT: 's' });

const FIXTURE = path.resolve(process.cwd(), 'test/fixtures/leadgen/offeneregister-beispiel.jsonl');

type Modul = {
  db: typeof import('@/lib/db');
  ingest: typeof import('./ingest');
  oreg: typeof import('./connectors/offeneregister');
  hr: typeof import('./connectors/handelsregister');
  nd: typeof import('./connectors/northdata');
  store: typeof import('./raw-store');
  queue: typeof import('./queue');
  kosten: typeof import('./kosten');
};
let m: Modul;

beforeAll(async () => {
  m = {
    db: await import('@/lib/db'),
    ingest: await import('./ingest'),
    oreg: await import('./connectors/offeneregister'),
    hr: await import('./connectors/handelsregister'),
    nd: await import('./connectors/northdata'),
    store: await import('./raw-store'),
    queue: await import('./queue'),
    kosten: await import('./kosten'),
  };
  m.db.getDb();
});

describe('Rohdaten-Schicht', () => {
  it('speichert unverändert und versioniert nur bei geändertem Inhalt', () => {
    const doc = { quelle: 'test', referenz: 'A1', inhalt: '{"a":1}' };
    const erst = m.store.speichereRohdokument(doc);
    expect(erst.neu).toBe(true);
    const zweit = m.store.speichereRohdokument(doc);
    expect(zweit).toEqual({ id: erst.id, neu: false });
    const neueVersion = m.store.speichereRohdokument({ ...doc, inhalt: '{"a":2}' });
    expect(neueVersion.neu).toBe(true);
    expect(neueVersion.id).not.toBe(erst.id);
    // Die alte Version bleibt unverändert erhalten
    const alt = m.db.getDb().select().from(m.db.schema.rawDocuments).all().find((r) => r.id === erst.id);
    expect(alt?.inhalt).toBe('{"a":1}');
    expect(alt?.inhaltHash).toBe(m.store.inhaltHash('{"a":1}'));
  });
});

describe('OffeneRegister-Ingestion (Beispieldatei mit 20 Firmen und einer defekten Zeile)', () => {
  it('liest alle brauchbaren Zeilen und überspringt defekte', async () => {
    const docs: string[] = [];
    for await (const d of new m.oreg.OffeneRegisterConnector({ datei: FIXTURE }).fetch()) docs.push(d.referenz);
    expect(docs).toHaveLength(20);
  });

  it('wendet Filter und Limit an', async () => {
    const treffer: string[] = [];
    const c = new m.oreg.OffeneRegisterConnector({ datei: FIXTURE, filter: (s) => /Formenbau/.test(String(s.name)) });
    for await (const d of c.fetch()) treffer.push(d.referenz);
    expect(treffer).toEqual(['K1102R_HRA200002']);
    const begrenzt: string[] = [];
    for await (const d of new m.oreg.OffeneRegisterConnector({ datei: FIXTURE, limit: 3 }).fetch()) begrenzt.push(d.referenz);
    expect(begrenzt).toHaveLength(3);
  });

  it('normalisiert und speichert Beobachtungen mit Herkunft, zweiter Lauf ändert nichts (idempotent)', async () => {
    const erst = await m.ingest.ingestQuelle(new m.oreg.OffeneRegisterConnector({ datei: FIXTURE }));
    expect(erst).toMatchObject({ dokumente: 20, neu: 20, unbrauchbar: 0 });
    expect(erst.beobachtungen).toBeGreaterThan(100);
    const zweit = await m.ingest.ingestQuelle(new m.oreg.OffeneRegisterConnector({ datei: FIXTURE }));
    expect(zweit).toMatchObject({ dokumente: 20, neu: 0, beobachtungen: 0 });

    const db = m.db.getDb();
    const obs = db.select().from(m.db.schema.attributeObservations).all();
    // Jede Beobachtung verweist auf ihr Rohdokument und nennt die Quelle
    expect(obs.every((o) => o.rawDocumentId && o.quelle === 'offeneregister')).toBe(true);
    const formenbau = obs.filter((o) => o.feld === 'name' && o.wert === 'Muster Formenbau');
    expect(formenbau).toHaveLength(1);
  });

  it('trennt Rechtsform, Register, Adresse und Personen korrekt', async () => {
    const docs: import('./types').RawDocument[] = [];
    for await (const d of new m.oreg.OffeneRegisterConnector({ datei: FIXTURE }).fetch()) docs.push(d);
    const satz = (ref: string) => m.oreg.normalisiereOffeneRegister(docs.find((d) => d.referenz === ref)!)!;

    expect(satz('K1102R_HRA200002')).toMatchObject({ name: 'Muster Formenbau', rechtsform: 'GmbH & Co. KG', registerart: 'HRA', registernummer: '200002', registergericht: 'Schwäbisch Gmünd' });
    expect(satz('K1102R_HRA200002').personen.map((p) => [p.nachname, p.rolle])).toEqual([['Schmidt-Meier', 'geschaeftsfuehrer'], ['Weiß', 'prokurist']]);
    expect(satz('K1101R_HRB100001').adresse).toMatchObject({ plz: '70469', ort: 'Stuttgart', bundeslandHerkunft: 'quelle' });
    // Kein Bundesland in der Quelle: aus der PLZ abgeleitet und als solches gekennzeichnet
    expect(satz('K1104R_HRB400004').adresse).toMatchObject({ bundesland: 'Sachsen', bundeslandHerkunft: 'plz' });
    // Komplementär-GmbH ist kein Ansprechpartner
    expect(satz('K1108R_HRB800008').personen.map((p) => p.nachname)).toEqual(['Hahn']);
    // Ehemalige Amtsträger (end_date) zählen nicht
    expect(satz('K1111R_HRB120011').personen.map((p) => p.nachname)).toEqual(['Neumann']);
  });

  it('liefert die Kennzahl: Firmen, mit Geschäftsführer, mit verifizierter E-Mail', () => {
    // 20 Firmen, davon eine (K1116R_HRB170016) ohne Amtsträger; E-Mails gibt es erst ab Phase 4
    expect(m.ingest.ladeKennzahlen()).toEqual({ firmen: 20, mitGeschaeftsfuehrer: 19, mitVerifizierterEmail: 0 });
  });

  it('wirft bei fehlendem Normalisierer', async () => {
    await expect(m.ingest.ingestQuelle({ quelle: 'unbekannt', async *fetch() {} })).rejects.toThrow(/Normalisierer/);
  });
});

describe('Handelsregister- und North-Data-Connector', () => {
  const abfrage = { registergericht: 'Stuttgart', registerart: 'HRB', registernummer: '100001' };

  it('ist standardmäßig deaktiviert', async () => {
    const c = new m.hr.HandelsregisterConnector({ abfragen: [abfrage], abruf: async () => ({ inhalt: 'x' }) });
    await expect((async () => { for await (const _ of c.fetch()) void _; })()).rejects.toBeInstanceOf(m.hr.HandelsregisterDeaktiviert);
  });

  it('drosselt Abrufe und nutzt danach den Cache', async () => {
    let abrufe = 0;
    let zeit = 1_000_000;
    const gewartet: number[] = [];
    const opt = {
      aktiv: true,
      abruf: async () => ({ inhalt: `<html>${++abrufe}</html>`, contentType: 'text/html' }),
      jetzt: () => zeit,
      warte: async (ms: number) => { gewartet.push(ms); zeit += ms; },
    };
    const a2 = { ...abfrage, registernummer: '100002' };
    const erst: string[] = [];
    for await (const d of new m.hr.HandelsregisterConnector({ ...opt, abfragen: [abfrage, a2] }).fetch()) {
      erst.push(d.inhalt);
      m.store.speichereRohdokument(d);
    }
    expect(erst).toEqual(['<html>1</html>', '<html>2</html>']);
    // Zwischen zwei Live-Abrufen mindestens der Mindestabstand
    expect(gewartet).toEqual([m.hr.HR_MIN_ABSTAND_MS]);
    // Zweiter Durchlauf: aus dem Cache, kein weiterer Abruf
    const zweit: string[] = [];
    for await (const d of new m.hr.HandelsregisterConnector({ ...opt, abfragen: [abfrage, a2], jetzt: () => Date.now() }).fetch()) zweit.push(d.inhalt);
    expect(abrufe).toBe(2);
    expect(zweit).toEqual(erst);
  });

  it('meldet fehlenden Abruf ehrlich, statt still nichts zu liefern', async () => {
    const c = new m.hr.HandelsregisterConnector({ aktiv: true, abfragen: [{ ...abfrage, registernummer: '424242' }] });
    await expect((async () => { for await (const _ of c.fetch()) void _; })()).rejects.toThrow(/Kein Abruf/);
  });

  it('North Data ist ein Platzhalter mit klarer Fehlermeldung', async () => {
    await expect((async () => { for await (const _ of new m.nd.NorthDataConnector().fetch()) void _; })()).rejects.toBeInstanceOf(m.nd.NorthDataNichtKonfiguriert);
  });
});

describe('Job-Queue', () => {
  it('legt Jobs idempotent an und übernimmt jeden nur einmal', () => {
    const run = m.queue.legeLaufAn({ branche: 'werkzeugbau' });
    expect(m.queue.reiheJobEin(run, 'ingestion')).toBe(true);
    expect(m.queue.reiheJobEin(run, 'ingestion')).toBe(false);
    m.queue.reiheJobEin(run, 'crawl', 7);
    const j1 = m.queue.holeFaelligenJob('ingestion');
    expect(j1).toMatchObject({ runId: run, stufe: 'ingestion', status: 'laeuft' });
    expect(m.queue.holeFaelligenJob('ingestion')).toBeNull();
    m.queue.schliesseJobAb(j1!.id);
    expect(m.queue.jobZaehler(run).find((z) => z.stufe === 'ingestion')).toMatchObject({ status: 'fertig', n: 1 });
  });

  it('wiederholt Fehlschläge mit Backoff und gibt danach auf (Fehler bleibt sichtbar)', () => {
    const run = m.queue.legeLaufAn({});
    m.queue.reiheJobEin(run, 'extraktion', 1);
    let jetzt = 5_000_000;
    const job = m.queue.holeFaelligenJob('extraktion', jetzt)!;
    expect(m.queue.meldeJobFehler(job.id, 'Timeout', jetzt)).toBe('wiederholt');
    // Vor Ablauf des Backoffs nicht fällig
    expect(m.queue.holeFaelligenJob('extraktion', jetzt + 30_000)).toBeNull();
    for (let i = 0; i < m.queue.LEADGEN_BACKOFF_MS.length - 1; i++) {
      jetzt += m.queue.LEADGEN_BACKOFF_MS[i] + 1;
      const j = m.queue.holeFaelligenJob('extraktion', jetzt)!;
      expect(j.id).toBe(job.id);
      expect(m.queue.meldeJobFehler(j.id, 'Timeout', jetzt)).toBe('wiederholt');
    }
    jetzt += m.queue.LEADGEN_BACKOFF_MS.at(-1)! + 1;
    const letzter = m.queue.holeFaelligenJob('extraktion', jetzt)!;
    expect(m.queue.meldeJobFehler(letzter.id, 'Endgültig kaputt', jetzt)).toBe('aufgegeben');
    expect(m.queue.holeFaelligenJob('extraktion', jetzt + 10 ** 9)).toBeNull();
    expect(m.queue.jobZaehler(run)).toEqual([{ stufe: 'extraktion', status: 'fehler', n: 1 }]);
  });

  it('gibt hängende Jobs beim Start wieder frei', () => {
    const run = m.queue.legeLaufAn({});
    m.queue.reiheJobEin(run, 'domain', 3);
    const j = m.queue.holeFaelligenJob('domain', 1_000)!;
    expect(m.queue.gibHaengendeJobsFrei(15 * 60_000, 1_000 + 60_000)).toBe(0);
    expect(m.queue.gibHaengendeJobsFrei(15 * 60_000, 1_000 + 16 * 60_000)).toBeGreaterThanOrEqual(1);
    expect(m.queue.holeFaelligenJob('domain', 2_000_000)?.id).toBe(j.id);
  });
});

describe('Kosten-Tracking', () => {
  it('summiert die Kosten je Lauf und Anbieter', () => {
    const run = m.queue.legeLaufAn({});
    m.kosten.protokolliereKosten({ runId: run, anbieter: 'openai', art: 'extraktion', einheiten: 1000, kostenMilliCent: 150 });
    m.kosten.protokolliereKosten({ runId: run, anbieter: 'openai', art: 'extraktion', einheiten: 500, kostenMilliCent: 75 });
    m.kosten.protokolliereKosten({ runId: run, anbieter: 'brave', art: 'suche', kostenMilliCent: 500 });
    const k = m.kosten.kostenEinesLaufs(run);
    expect(k.gesamtMilliCent).toBe(725);
    expect(k.nachAnbieter.find((x) => x.anbieter === 'openai')).toMatchObject({ einheiten: 1500, kostenMilliCent: 225 });
  });
});
