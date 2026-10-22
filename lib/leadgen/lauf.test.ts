import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-lauf-'));
Object.assign(process.env, { DATA_DIR: dir, ADMIN_PASSWORD: 'x', SESSION_SECRET: 'x'.repeat(32), ENCRYPTION_KEY: '0'.repeat(64), IP_HASH_SALT: 's' });
const FIXTURE = path.resolve(process.cwd(), 'test/fixtures/leadgen/offeneregister-beispiel.jsonl');

type Mod = {
  db: typeof import('@/lib/db');
  lauf: typeof import('./lauf');
  stufen: typeof import('./stufen');
  ingest: typeof import('./ingest');
  oreg: typeof import('./connectors/offeneregister');
  fetcher: typeof import('./crawl/fetcher');
  search: typeof import('./search/provider');
  prov: typeof import('./extract/provider');
  ver: typeof import('./contacts/verifier');
  rollen: typeof import('./contacts/rollen');
  erg: typeof import('./ergebnisse');
  uebernahme: typeof import('./uebernahme');
  csv: typeof import('./csv');
  sperre: typeof import('./sperre');
  queue: typeof import('./queue');
  supp: typeof import('@/lib/suppression');
  res: typeof import('./resolve/resolve');
};
let m: Mod;

// ---------------------------------------------------------------- Fake-Internet für drei Firmen des Seeds

const SEITEN: Record<string, string> = {
  // Beispiel Werkzeugbau: Domain bestätigt, Einkaufsleiterin und Geschäftsführer auf der Teamseite, bekanntes E-Mail-Muster
  'https://www.beispiel-werkzeugbau.de/': '<nav><a href="/impressum">Impressum</a><a href="/team">Team</a></nav><h1>Beispiel Werkzeugbau</h1><p>Wir fertigen Stanzwerkzeuge für die Automobilindustrie. Über 230 Mitarbeitende.</p>',
  'https://www.beispiel-werkzeugbau.de/impressum': '<p>Beispiel Werkzeugbau GmbH, Industriestraße 4, 70469 Stuttgart. Registergericht Amtsgericht Stuttgart, HRB 100001. Tel. 0711 1234567</p>',
  'https://www.beispiel-werkzeugbau.de/team': '<h2>Ansprechpartner</h2><p>Hans Müller, Geschäftsführer, hans.mueller@beispiel-werkzeugbau.de</p><p>Anna Roth, Leiterin Einkauf</p>',
  // Beta: Domain bestätigt, Catch-All-Mailserver, nur das Postfach info@ auf der Seite
  'https://www.beta-werkzeugbau.de/': '<nav><a href="/impressum">Impressum</a></nav><h1>Beta Spritzguss</h1><p>Spritzgussformen und Werkzeugbau.</p>',
  'https://www.beta-werkzeugbau.de/impressum': '<p>Beta Spritzguss &amp; Werkzeugbau GmbH, Gewerbering 9, 78056 Villingen-Schwenningen. HRB 800008. Mail: info@beta-werkzeugbau.de</p>',
};
const LLM_ROLLEN: Record<string, string> = { 'Hans Müller': 'Geschäftsführer', 'Anna Roth': 'Leiterin Einkauf' };

function fakeFetch(fehlerHost?: string): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    if (fehlerHost && u.includes(fehlerHost)) throw new Error('kaputt');
    if (u.endsWith('/robots.txt')) return new Response('', { status: 404 });
    const body = SEITEN[u];
    return body === undefined ? new Response('', { status: 404 }) : new Response(`<html><body>${body}</body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
}

function deps(opt: { catchAll?: string[]; gueltig?: string[]; sucheFehlerBei?: string } = {}) {
  const zeit = Date.now();
  const verifier = new m.ver.GedrosselterVerifier({
    verifier: new m.ver.FakeVerifier((a) => (opt.catchAll?.some((d) => a.endsWith(`@${d}`)) ? 'gueltig' : opt.gueltig?.includes(a) ? 'gueltig' : 'ungueltig')),
    mx: async () => 'ok',
    minAbstandMs: 0,
    jetzt: () => zeit,
    warte: async () => undefined,
    zufall: () => 'zzprobe',
  });
  void zeit;
  const suche = new m.search.FakeSearchProvider((q) => {
    if (opt.sucheFehlerBei && q.includes(opt.sucheFehlerBei)) throw new m.search.SuchFehler('Suche kaputt', true);
    if (q.includes('Beispiel Werkzeugbau')) return [{ titel: 'Beispiel Werkzeugbau', url: 'https://www.beispiel-werkzeugbau.de/produkte', snippet: 'Beispiel Werkzeugbau Stuttgart' }];
    if (q.includes('Beta Spritzguss')) return [{ titel: 'Beta', url: 'https://www.beta-werkzeugbau.de/', snippet: 'Beta Spritzguss & Werkzeugbau' }];
    return [];
  });
  const fetcher = new m.fetcher.HoeflicherFetcher({ f: fakeFetch(), resolver: async () => ['93.184.216.34'], minAbstandMs: 0, userAgent: 'TestBot' });
  const extraktion = new m.prov.FakeExtractionProvider((schema, text) => {
    if (schema === 'branche') return { branche: 'werkzeugbau', konfidenz: 0.9, beleg: text.includes('Stanzwerkzeuge') ? 'Wir fertigen Stanzwerkzeuge für die Automobilindustrie.' : 'Spritzgussformen und Werkzeugbau.' };
    if (schema === 'personen') return { personen: Object.entries(LLM_ROLLEN).filter(([n]) => text.includes(n)).map(([n, rolle]) => ({ vorname: n.split(' ')[0], nachname: n.split(' ')[1], rolle, email: null, telefon: null, telefonArt: null })), telefone: [] };
    return { personen: [] };
  });
  return (runId: number) => ({ suche, fetcher, extraktion, verifier, rollen: m.rollen.standardRollen, runId, finder: undefined }) as import('./contacts/steps').KontaktDeps;
}

async function laufen(d: (runId: number) => import('./contacts/steps').KontaktDeps, maxSchritte = 500) {
  let n = 0;
  let jetzt = Date.now();
  while (n++ < maxSchritte) {
    // Zeit vorstellen, damit Backoff-Wartezeiten ablaufen
    jetzt += 3 * 3600_000;
    if (!(await m.stufen.verarbeiteNaechstenJob(d, { jetzt }))) return n;
  }
  throw new Error('Lauf endet nicht');
}

const FILTER = { branchen: ['werkzeugbau', 'formenbau'], bundeslaender: ['Baden-Württemberg'], zielRolle: 'einkauf_leitung', nurVerifizierteEmail: false } as const;
const filter = (p: Record<string, unknown> = {}) => m.lauf.LaufFilterSchema.parse({ ...FILTER, ...p });

beforeAll(async () => {
  m = {
    db: await import('@/lib/db'), lauf: await import('./lauf'), stufen: await import('./stufen'), ingest: await import('./ingest'), oreg: await import('./connectors/offeneregister'),
    fetcher: await import('./crawl/fetcher'), search: await import('./search/provider'), prov: await import('./extract/provider'), ver: await import('./contacts/verifier'),
    rollen: await import('./contacts/rollen'), erg: await import('./ergebnisse'), uebernahme: await import('./uebernahme'), csv: await import('./csv'), sperre: await import('./sperre'),
    queue: await import('./queue'), supp: await import('@/lib/suppression'), res: await import('./resolve/resolve'),
  };
  m.db.getDb();
});

describe('Lauf ohne Datenbestand', () => {
  it('scheitert verständlich in der Stufe Ingestion und ist als „fehler“ sichtbar', async () => {
    const run = m.lauf.starteLauf(filter());
    await laufen(deps());
    const s = m.lauf.ladeLaufStatus(run)!;
    expect(s.status).toBe('fehler');
    expect(s.fehlerhafteJobs[0]).toMatchObject({ stufe: 'ingestion', fehler: expect.stringMatching(/Kein Datenbestand/) });
  });
});

describe('Pipeline-Lauf: Filter → Stufen → Ergebnis (mit Fake-Diensten)', () => {
  let runId: number;
  it('wählt Firmen nach dem Filter aus dem aufgelösten Bestand', async () => {
    await m.ingest.ingestQuelle(new m.oreg.OffeneRegisterConnector({ datei: FIXTURE }));
    m.res.loeseEntitaetenAuf();
    const ids = m.lauf.waehleFirmen(filter());
    const namen = m.db.getDb().select().from(m.db.schema.companies).all().filter((c) => ids.includes(c.id)).map((c) => c.name).sort();
    // Baden-Württemberg und Werkzeug-/Formenbau-Namen; Fiktiv Vorrichtungsbau (Ulm) hat kein Bundesland in der Quelle und fällt durch
    expect(namen).toEqual(['Beispiel Werkzeugbau', 'Beta Spritzguss & Werkzeugbau', 'Muster Formenbau']);
    expect(m.lauf.waehleFirmen(filter({ maxFirmen: 2 }))).toHaveLength(2);
    expect(m.lauf.waehleFirmen(filter({ plzPraefixe: ['70'], bundeslaender: [] }))).toHaveLength(1);
    expect(m.lauf.waehleFirmen(filter({ rechtsformen: ['AG'], branchen: [], bundeslaender: [] }))).toHaveLength(1);
  });

  it('durchläuft alle Stufen; Fortschritt je Stufe, Kosten und Kennzahlen sind sichtbar', async () => {
    runId = m.lauf.starteLauf(filter());
    const d = deps({ gueltig: ['anna.roth@beispiel-werkzeugbau.de'], catchAll: ['beta-werkzeugbau.de'] });
    await laufen(d);
    const s = m.lauf.ladeLaufStatus(runId)!;
    expect(s.status).toBe('fertig');
    expect(s.firmen).toBe(3);
    const je = (stufe: string) => s.stufen.find((x) => x.stufe === stufe)!;
    expect(je('ingestion')).toMatchObject({ fertig: 1 });
    expect(je('resolution')).toMatchObject({ fertig: 1 });
    expect(je('domain')).toMatchObject({ fertig: 3, fehler: 0 });
    // Zwei Firmen mit bestätigter Domain werden gecrawlt, extrahiert und von der Kontakt-Engine bearbeitet
    expect(je('crawl').fertig).toBe(2);
    expect(je('extraktion').fertig).toBe(2);
    expect(je('kontakt').fertig).toBe(2);
    // Golden Record und Scoring laufen für alle drei (auch die ohne Domain)
    expect(je('golden').fertig).toBe(3);
    expect(je('scoring').fertig).toBe(3);
    expect(s.fehlerhafteJobs).toEqual([]);
  });

  it('Ergebnisliste: Person, Rolle, E-Mail mit Status, Quelle und Konfidenz je Feld, Scores', () => {
    const r = m.erg.ladeLaufErgebnisse(runId)!;
    expect(r.zeilen).toHaveLength(3);
    const beispiel = r.zeilen.find((z) => z.firma.startsWith('Beispiel Werkzeugbau'))!;
    expect(beispiel.person).toMatchObject({ vorname: 'Anna', nachname: 'Roth', rolle: 'einkauf_leitung', rollenTreffer: 'exakt' });
    expect(beispiel.email).toMatchObject({ adresse: 'anna.roth@beispiel-werkzeugbau.de', status: 'gueltig', muster: 'vorname.nachname' });
    expect(beispiel.email!.konfidenz).toBeGreaterThan(0.5);
    expect(beispiel.domain).toBe('beispiel-werkzeugbau.de');
    expect(beispiel.branche).toBe('werkzeugbau');
    expect(beispiel.herkunft.domain).toMatchObject({ quelle: expect.stringMatching(/^suche:/) });
    expect(beispiel.telefone.map((t) => t.art)).toContain('zentrale');
    expect(beispiel.mitarbeiter).toMatchObject({ zahl: 230, typ: 'schaetzung', klasse: '100-249' });
    expect(beispiel.scores.gesamt).toBeGreaterThan(60);
    expect(beispiel.hinweise).not.toContain('rolle_fallback');

    // Catch-All-Domain: nur „best guess“, Geschäftsführer aus dem Register als Fallback-Rolle, klar markiert
    const beta = r.zeilen.find((z) => z.firma.startsWith('Beta'))!;
    expect(beta.email).toMatchObject({ status: 'catch_all_best_guess' });
    expect(beta.email!.konfidenz).toBeLessThanOrEqual(0.4);
    expect(beta.hinweise).toEqual(expect.arrayContaining(['catch_all', 'rolle_fallback']));
    expect(beta.scores.gesamt!).toBeLessThan(beispiel.scores.gesamt!);

    // Ohne Domain: keine Kontaktdaten, „Rolle offen“, niedrigster Score, steht trotzdem in der Liste
    const muster = r.zeilen.find((z) => z.firma.startsWith('Muster'))!;
    expect(muster.email).toBeNull();
    expect(muster.hinweise).toContain('branche_unbekannt');
    expect(muster.scores.gesamt!).toBeLessThan(beta.scores.gesamt!);
    // Sortiert nach Gesamt-Score absteigend
    expect(r.zeilen.map((z) => z.scores.gesamt)).toEqual([...r.zeilen.map((z) => z.scores.gesamt)].sort((a, b) => (b ?? 0) - (a ?? 0)));
  });

  it('Filter der Liste: nur verifizierte E-Mails und Mindest-Score', () => {
    expect(m.erg.ladeLaufErgebnisse(runId, { nurVerifizierteEmail: true })!.zeilen.map((z) => z.firma)).toEqual(['Beispiel Werkzeugbau GmbH']);
    const spitze = m.erg.ladeLaufErgebnisse(runId)!.zeilen[0].scores.gesamt!;
    expect(m.erg.ladeLaufErgebnisse(runId, { mindestScore: spitze })!.zeilen.length).toBeGreaterThanOrEqual(1);
    expect(m.erg.ladeLaufErgebnisse(runId, { mindestScore: spitze + 1 })!.zeilen).toHaveLength(0);
    const mitMin = m.erg.ladeLaufErgebnisse(runId, { mindestScore: 50 })!;
    expect(mitMin.zeilen.every((z) => (z.scores.gesamt ?? 0) >= 50)).toBe(true);
    expect(m.erg.ladeLaufErgebnisse(runId, { limit: 1 })!.zeilen).toHaveLength(1);
  });

  it('Kennzahl nach dieser Phase: Firmen, mit Geschäftsführer, mit verifizierter E-Mail', () => {
    const k = m.ingest.ladeKennzahlen();
    expect(k.firmen).toBe(20);
    expect(k.mitGeschaeftsfuehrer).toBeGreaterThanOrEqual(19);
    expect(k.mitVerifizierterEmail).toBe(1);
  });

  let campaignId: number;
  it('Übernahme: Dedup gegen Bestand und Auswahl, Sperrliste, Status-Prüfung, Herkunftsprotokoll', () => {
    const db = m.db.getDb();
    campaignId = db.insert(m.db.schema.campaigns).values({ name: 'Testkampagne', emailSubjectTemplate: 'Hallo', emailBodyTemplate: 'Text', ctaUrl: 'https://example.org' }).returning({ id: m.db.schema.campaigns.id }).get().id;
    const ids = m.erg.ladeLaufErgebnisse(runId)!.zeilen.map((z) => z.companyId);
    const beispiel = m.erg.ladeLaufErgebnisse(runId)!.zeilen.find((z) => z.firma.startsWith('Beispiel'))!.companyId;
    const beta = m.erg.ladeLaufErgebnisse(runId)!.zeilen.find((z) => z.firma.startsWith('Beta'))!.companyId;
    const muster = m.erg.ladeLaufErgebnisse(runId)!.zeilen.find((z) => z.firma.startsWith('Muster'))!.companyId;

    // Standard: nur verifizierte E-Mails; Beta (best guess) und Muster (keine E-Mail) werden abgelehnt, doppelte ID in der Auswahl auch
    const erst = m.uebernahme.uebernehmeInKampagne({ runId, campaignId, companyIds: [...ids, beispiel], benutzer: 'tester' });
    const status = Object.fromEntries(erst.zeilen.map((z, i) => [`${z.companyId}#${i}`, z.status]));
    expect(erst.uebernommen).toBe(1);
    expect(erst.zeilen.find((z) => z.companyId === beispiel && z.status === 'uebernommen')).toBeTruthy();
    expect(erst.zeilen.find((z) => z.companyId === beta)!.status).toBe('email_status_nicht_erlaubt');
    expect(erst.zeilen.find((z) => z.companyId === muster)!.status).toBe('keine_email');
    expect(Object.values(status)).toContain('duplikat_auswahl');

    const lead = db.select().from(m.db.schema.leads).all().find((l) => l.leadgenCompanyId === beispiel)!;
    expect(lead).toMatchObject({ email: 'anna.roth@beispiel-werkzeugbau.de', vorname: 'Anna', nachname: 'Roth', firma: 'Beispiel Werkzeugbau GmbH', position: 'Leiterin Einkauf', website: 'https://beispiel-werkzeugbau.de', campaignId });
    expect(lead.extra).toMatchObject({ 'E-Mail-Status': 'gueltig' });
    // Herkunft für Art. 14 DSGVO
    const protokoll = db.select().from(m.db.schema.leadgenUebernahmen).all().find((p) => p.leadId === lead.id)!;
    expect(protokoll).toMatchObject({ runId, companyId: beispiel, campaignId, benutzer: 'tester' });
    expect(protokoll.herkunft).toMatchObject({ email: { status: 'gueltig', muster: 'vorname.nachname' } });

    // Zweiter Versuch: schon übernommen
    expect(m.uebernahme.uebernehmeInKampagne({ runId, campaignId, companyIds: [beispiel] }).zeilen[0].status).toBe('duplikat_kontakt');
    // Andere Kampagne: Kontakt existiert schon in einer Kampagne
    const zweite = db.insert(m.db.schema.campaigns).values({ name: 'Zweite', emailSubjectTemplate: 'x', emailBodyTemplate: 'y', ctaUrl: 'https://example.org' }).returning({ id: m.db.schema.campaigns.id }).get().id;
    expect(m.uebernahme.uebernehmeInKampagne({ runId, campaignId: zweite, companyIds: [beispiel] }).zeilen[0].status).toBe('duplikat_kontakt');

    // Sperrliste (Domain-Eintrag, z. B. Kunde): auch mit erlaubtem best-guess-Status wird nichts übernommen
    m.supp.addSuppression('@beta-werkzeugbau.de', 'kunde');
    expect(m.uebernahme.uebernehmeInKampagne({ runId, campaignId, companyIds: [beta], statusErlaubt: ['gueltig', 'catch_all_best_guess'] }).zeilen[0].status).toBe('gesperrt');
    m.supp.removeSuppression('@beta-werkzeugbau.de');
    // Ohne Sperre geht der best guess durch, wenn der Nutzer ihn ausdrücklich zulässt
    expect(m.uebernahme.uebernehmeInKampagne({ runId, campaignId, companyIds: [beta], statusErlaubt: ['gueltig', 'catch_all_best_guess'] }).zeilen[0].status).toBe('uebernommen');
    // Unbekannter Lauf-Teilnehmer
    expect(m.uebernahme.uebernehmeInKampagne({ runId, campaignId, companyIds: [999_999] }).zeilen[0].status).toBe('nicht_im_lauf');
    expect(() => m.uebernahme.uebernehmeInKampagne({ runId, campaignId: 999_999, companyIds: [] })).toThrow(/Kampagne/);
  });

  it('CSV-Export mit Herkunft und Konfidenz, Excel-sicher', () => {
    const zeilen = m.erg.ladeLaufErgebnisse(runId)!.zeilen;
    const csv = m.csv.ergebnisCsv(zeilen);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('E-Mail Status');
    expect(csv).toContain('verifiziert');
    expect(csv).toContain('catch-all, unverifiziert (best guess)');
    expect(m.csv.csvZelle('=SUMME(A1)')).toBe("'=SUMME(A1)");
    expect(m.csv.csvZelle('a;b')).toBe('"a;b"');
  });

  it('Löschfunktion pro Person: Daten weg, Adresse gesperrt, Lead anonymisiert, Wiederauftauchen blockiert (auch bei neuem Lauf)', async () => {
    const db = m.db.getDb();
    const beispiel = db.select().from(m.db.schema.companies).all().find((c) => c.name === 'Beispiel Werkzeugbau')!;
    const anna = db.select().from(m.db.schema.persons).all().find((p) => p.companyId === beispiel.id && p.nachname === 'Roth')!;
    const erg = m.sperre.loeschePerson(anna.id);
    expect(erg).toMatchObject({ adressenGesperrt: 1, leadsAnonymisiert: 1 });
    expect(erg.beobachtungen).toBeGreaterThan(0);
    expect(db.select().from(m.db.schema.persons).all().some((p) => p.id === anna.id)).toBe(false);
    expect(db.select().from(m.db.schema.contactPoints).all().some((c) => c.wert === 'anna.roth@beispiel-werkzeugbau.de')).toBe(false);
    expect(m.supp.isSuppressed('anna.roth@beispiel-werkzeugbau.de')).toBe(true);
    const lead = db.select().from(m.db.schema.leads).all().find((l) => l.leadgenCompanyId === beispiel.id)!;
    expect(lead).toMatchObject({ vorname: null, nachname: null, position: null });
    // Der Name steht in den gespeicherten Rohseiten nicht mehr
    expect(db.select().from(m.db.schema.rawDocuments).all().some((r) => r.inhalt.includes('Anna Roth'))).toBe(false);
    // Es werden nur Hashes gespeichert, nie der Name
    expect(db.select().from(m.db.schema.personSperre).all().every((s) => /^[0-9a-f]{64}$/.test(s.hash))).toBe(true);

    // Neuer Lauf: die Seite nennt Anna Roth weiter (Fake-Web) – sie darf nicht zurückkommen, der Geschäftsführer wird Fallback
    // (Seiten-Cache leeren, damit wirklich neu extrahiert wird)
    SEITEN['https://www.beispiel-werkzeugbau.de/team'] = '<h2>Ansprechpartner</h2><p>Hans Müller, Geschäftsführer, hans.mueller@beispiel-werkzeugbau.de</p><p>Anna Roth, Leiterin Einkauf</p><p>Stand 2</p>';
    db.delete(m.db.schema.crawlPages).run();
    const run2 = m.lauf.starteLauf(filter());
    await laufen(deps({ gueltig: ['hans.mueller@beispiel-werkzeugbau.de'] }));
    expect(db.select().from(m.db.schema.persons).all().some((p) => p.nachname === 'Roth' && p.companyId === beispiel.id)).toBe(false);
    const r2 = m.erg.ladeLaufErgebnisse(run2, { nurVerifizierteEmail: false })!.zeilen.find((z) => z.companyId === beispiel.id)!;
    expect(r2.person).toMatchObject({ nachname: 'Müller' });
    expect(r2.hinweise).toContain('rolle_fallback');
  });
});

describe('Fehlerbehandlung der Stufen', () => {
  it('ein technischer Fehler wird mit Backoff wiederholt, danach sichtbar als fehlgeschlagen und lässt sich von Hand wiederholen', async () => {
    const run = m.lauf.starteLauf(filter({ branchen: ['formenbau'] }));
    // Die Suche schlägt für diese Firma immer fehl
    await laufen(deps({ sucheFehlerBei: 'Muster Formenbau' }));
    let s = m.lauf.ladeLaufStatus(run)!;
    expect(s.status).toBe('fertig');
    expect(s.stufen.find((x) => x.stufe === 'domain')).toMatchObject({ fehler: 1 });
    const job = s.fehlerhafteJobs.find((j) => j.stufe === 'domain')!;
    expect(job).toMatchObject({ firma: 'Muster Formenbau', versuche: 5, fehler: 'Suche kaputt' });
    // Händisch wiederholen, jetzt klappt die Suche
    expect(m.lauf.wiederholeJob(job.id)).toBe(true);
    expect(m.lauf.wiederholeJob(job.id)).toBe(false);
    expect(m.lauf.ladeLaufStatus(run)!.status).toBe('laeuft');
    await laufen(deps());
    s = m.lauf.ladeLaufStatus(run)!;
    // (Beta Spritzguss ist durch den ersten Lauf schon als Werkzeugbau klassifiziert und kommt bei „Formenbau“ nicht mehr in Frage)
    expect(s.stufen.find((x) => x.stufe === 'domain')).toMatchObject({ fehler: 0, fertig: 1 });
    expect(s.stufen.find((x) => x.stufe === 'scoring')).toMatchObject({ fertig: 1 });
  });

  it('Kostenanzeige je Lauf', () => {
    const run = m.lauf.starteLauf(filter());
    m.queue.reiheJobEin(run, 'kontakt', 1);
    expect(m.lauf.ladeLaufStatus(run)!.kostenMilliCent).toBe(0);
    expect(m.lauf.ladeLaufStatus(999_999)).toBeNull();
  });
});

describe('Filter und ICP', () => {
  it('validiert den Filter und setzt Standardwerte', () => {
    expect(m.lauf.LaufFilterSchema.parse({})).toMatchObject({ mitarbeiterMin: 100, mitarbeiterMax: 800, zielRolle: 'einkauf_leitung', nurVerifizierteEmail: true, maxFirmen: 200 });
    expect(() => m.lauf.LaufFilterSchema.parse({ plzPraefixe: ['abc'] })).toThrow();
    expect(() => m.lauf.LaufFilterSchema.parse({ maxFirmen: 100000 })).toThrow();
  });
  it('leitet die ICP-Konfiguration aus dem Filter ab', () => {
    const k = m.lauf.icpAusFilter(filter({ branchen: ['werkzeugbau'], mitarbeiterMin: 200, mitarbeiterMax: 500, plzPraefixe: ['70'], bundeslaender: [] }));
    expect(k.branchen).toMatchObject({ werkzeugbau: 1, formenbau: 0, maschinenbau: 0 });
    expect(k).toMatchObject({ mitarbeiterMin: 200, mitarbeiterMax: 500, plzPraefixe: ['70'] });
  });
});
