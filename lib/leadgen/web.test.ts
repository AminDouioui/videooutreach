import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-web-'));
Object.assign(process.env, { DATA_DIR: dir, ADMIN_PASSWORD: 'x', SESSION_SECRET: 'x'.repeat(32), ENCRYPTION_KEY: '0'.repeat(64), IP_HASH_SALT: 's' });

type Mod = {
  db: typeof import('@/lib/db');
  fetcher: typeof import('./crawl/fetcher');
  domain: typeof import('./crawl/domain-finder');
  web: typeof import('./web');
  run: typeof import('./extract/run');
  prov: typeof import('./extract/provider');
  oai: typeof import('./extract/openai-provider');
  search: typeof import('./search/provider');
  brave: typeof import('./search/brave');
  kosten: typeof import('./kosten');
  queue: typeof import('./queue');
};
let m: Mod;

beforeAll(async () => {
  m = {
    db: await import('@/lib/db'),
    fetcher: await import('./crawl/fetcher'),
    domain: await import('./crawl/domain-finder'),
    web: await import('./web'),
    run: await import('./extract/run'),
    prov: await import('./extract/provider'),
    oai: await import('./extract/openai-provider'),
    search: await import('./search/provider'),
    brave: await import('./search/brave'),
    kosten: await import('./kosten'),
    queue: await import('./queue'),
  };
  m.db.getDb();
});

// ---------------------------------------------------------------- Fake-Web

type Antwort = { status?: number; body?: string; type?: string; location?: string };
/** Kleines Fake-Web: URL → Antwort. Zählt Abrufe je URL. */
function fakeWeb(seiten: Record<string, Antwort | string>) {
  const abrufe: string[] = [];
  const f = (async (url: string | URL | Request) => {
    const u = String(url);
    abrufe.push(u);
    const a = seiten[u];
    if (a === undefined) return new Response('nicht gefunden', { status: 404 });
    const r = typeof a === 'string' ? { body: a } : a;
    const headers: Record<string, string> = { 'content-type': r.type ?? 'text/html; charset=utf-8' };
    if (r.location) headers.location = r.location;
    return new Response(r.body ?? '', { status: r.status ?? 200, headers });
  }) as typeof fetch;
  return { f, abrufe };
}
const oeffentlich = async () => ['93.184.216.34'];
let zeit = Date.now();
const neuerFetcher = (f: typeof fetch, extra: Record<string, unknown> = {}) => {
  const wartezeiten: number[] = [];
  const fetcher = new m.fetcher.HoeflicherFetcher({
    f,
    resolver: oeffentlich,
    userAgent: 'TestBot/1.0',
    jetzt: () => zeit,
    warte: async (ms) => {
      wartezeiten.push(ms);
      zeit += ms;
    },
    ...extra,
  });
  return { fetcher, wartezeiten };
};

describe('Höflicher Fetcher', () => {
  it('respektiert robots.txt (Disallow) und ruft gesperrte Seiten nicht ab', async () => {
    const web = fakeWeb({ 'https://a.de/robots.txt': { body: 'User-agent: *\nDisallow: /intern/', type: 'text/plain' }, 'https://a.de/intern/x': '<p>geheim</p>', 'https://a.de/offen': '<p>offen</p>' });
    const { fetcher } = neuerFetcher(web.f);
    expect(await fetcher.holeSeite('https://a.de/intern/x')).toEqual({ status: 'robots', url: 'https://a.de/intern/x' });
    expect(web.abrufe).not.toContain('https://a.de/intern/x');
    expect((await fetcher.holeSeite('https://a.de/offen')).status).toBe('ok');
  });

  it('beachtet Regeln für den eigenen User-Agent und Crawl-delay', async () => {
    const web = fakeWeb({ 'https://b.de/robots.txt': { body: 'User-agent: TestBot\nDisallow: /\n\nUser-agent: *\nAllow: /', type: 'text/plain' }, 'https://b.de/x': '<p>x</p>' });
    expect((await neuerFetcher(web.f).fetcher.holeSeite('https://b.de/x')).status).toBe('robots');
    const web2 = fakeWeb({ 'https://c.de/robots.txt': { body: 'User-agent: *\nCrawl-delay: 10', type: 'text/plain' }, 'https://c.de/1': '<p>1</p>', 'https://c.de/2': '<p>2</p>' });
    const { fetcher, wartezeiten } = neuerFetcher(web2.f);
    await fetcher.holeSeite('https://c.de/1');
    await fetcher.holeSeite('https://c.de/2');
    // Der zweite Abruf wartet mindestens die Crawl-delay-Zeit
    expect(Math.max(...wartezeiten)).toBeGreaterThanOrEqual(10_000 - 100);
  });

  it('drosselt Abrufe derselben Domain', async () => {
    const web = fakeWeb({ 'https://d.de/1': '<p>1</p>', 'https://d.de/2': '<p>2</p>' });
    const { fetcher, wartezeiten } = neuerFetcher(web.f, { minAbstandMs: 3000 });
    await fetcher.holeSeite('https://d.de/1');
    await fetcher.holeSeite('https://d.de/2');
    expect(wartezeiten.length).toBeGreaterThan(0);
    expect(wartezeiten.every((w) => w <= 3000)).toBe(true);
  });

  it('cached Seiten in der Rohdaten-Schicht: zweiter Abruf ohne Netz', async () => {
    const web = fakeWeb({ 'https://e.de/impressum': '<p>Impressum</p>' });
    const { fetcher } = neuerFetcher(web.f);
    const erst = await fetcher.holeSeite('https://e.de/impressum');
    const vorher = web.abrufe.length;
    const zweit = await fetcher.holeSeite('https://e.de/impressum');
    expect(erst).toMatchObject({ status: 'ok', ausCache: false });
    expect(zweit).toMatchObject({ status: 'ok', ausCache: true });
    expect(web.abrufe.length).toBe(vorher);
    if (erst.status === 'ok' && zweit.status === 'ok') expect(zweit.rawDocumentId).toBe(erst.rawDocumentId);
  });

  it('holt abgelaufenen Cache neu und versioniert nur bei geändertem Inhalt', async () => {
    let inhalt = '<p>v1</p>';
    const f = (async (url: string | URL | Request) => (String(url).endsWith('robots.txt') ? new Response('', { status: 404 }) : new Response(inhalt, { headers: { 'content-type': 'text/html' } }))) as typeof fetch;
    const { fetcher } = neuerFetcher(f, { cacheMs: 1000 });
    const a = await fetcher.holeSeite('https://f.de/');
    zeit += 5000;
    const b = await fetcher.holeSeite('https://f.de/');
    inhalt = '<p>v2</p>';
    zeit += 5000;
    const c = await fetcher.holeSeite('https://f.de/');
    if (a.status !== 'ok' || b.status !== 'ok' || c.status !== 'ok') throw new Error('erwartet ok');
    expect(b.rawDocumentId).toBe(a.rawDocumentId);
    expect(c.rawDocumentId).not.toBe(a.rawDocumentId);
  });

  it('lehnt Ziele im internen Netz ab (auch per DNS-Auflösung und Weiterleitung)', async () => {
    const web = fakeWeb({ 'https://g.de/': '<p>g</p>' });
    const intern = neuerFetcher(web.f, { resolver: async () => ['10.0.0.5'] }).fetcher;
    expect(await intern.holeSeite('https://g.de/')).toMatchObject({ status: 'fehler' });
    expect(web.abrufe).toHaveLength(0);
    const web2 = fakeWeb({ 'https://h.de/': { status: 301, location: 'http://127.0.0.1/admin' } });
    const r = await neuerFetcher(web2.f).fetcher.holeSeite('https://h.de/');
    expect(r.status).toBe('fehler');
    expect(web2.abrufe.some((u) => u.includes('127.0.0.1'))).toBe(false);
  });

  it('folgt Weiterleitungen begrenzt und lehnt andere Inhaltstypen und zu große Seiten ab', async () => {
    const web = fakeWeb({
      'https://i.de/alt': { status: 301, location: 'https://i.de/neu' },
      'https://i.de/neu': '<p>neu</p>',
      'https://i.de/loop': { status: 302, location: 'https://i.de/loop' },
      'https://i.de/a.pdf': { body: '%PDF', type: 'application/pdf' },
      'https://i.de/gross': 'x'.repeat(2000),
    });
    const { fetcher } = neuerFetcher(web.f, { maxBytes: 1000 });
    expect(await fetcher.holeSeite('https://i.de/alt')).toMatchObject({ status: 'ok', finaleUrl: 'https://i.de/neu' });
    expect(await fetcher.holeSeite('https://i.de/loop')).toMatchObject({ status: 'fehler', fehler: expect.stringMatching(/Weiterleitungen/) });
    expect(await fetcher.holeSeite('https://i.de/a.pdf')).toMatchObject({ status: 'fehler', fehler: expect.stringMatching(/Kein HTML/) });
    expect(await fetcher.holeSeite('https://i.de/gross')).toMatchObject({ status: 'fehler', fehler: 'Seite zu groß' });
  });

  it('meldet HTTP-Fehler und behandelt nicht abrufbare robots.txt vorsichtig (5xx = nichts erlaubt)', async () => {
    const web = fakeWeb({ 'https://j.de/robots.txt': { status: 503 }, 'https://j.de/x': '<p>x</p>' });
    expect(await neuerFetcher(web.f).fetcher.holeSeite('https://j.de/x')).toMatchObject({ status: 'fehler' });
    const web2 = fakeWeb({ 'https://k.de/fehler': { status: 500 } });
    expect(await neuerFetcher(web2.f).fetcher.holeSeite('https://k.de/fehler')).toMatchObject({ status: 'fehler', fehler: 'HTTP 500' });
    expect(await neuerFetcher(web2.f).fetcher.holeSeite('ftp://k.de/x')).toMatchObject({ status: 'fehler' });
  });

  it('sendet den eigenen User-Agent', async () => {
    let ua = '';
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).endsWith('robots.txt')) ua = new Headers(init?.headers).get('user-agent') ?? '';
      return String(url).endsWith('robots.txt') ? new Response('', { status: 404 }) : new Response('<p>x</p>', { headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    await neuerFetcher(f).fetcher.holeSeite('https://l.de/');
    expect(ua).toBe('TestBot/1.0');
  });
});

describe('Brave-Search-Provider', () => {
  const treffer = { web: { results: [{ title: 'Müller Werkzeugbau', url: 'https://www.mueller-werkzeugbau.de/', description: 'Werkzeugbau in Stuttgart' }, { title: 'ohne url' }] } };
  it('liest Treffer, sendet Schlüssel und protokolliert die Anfrage', async () => {
    let kopf: Headers | undefined;
    let url = '';
    const f = (async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u);
      kopf = new Headers(init?.headers);
      return new Response(JSON.stringify(treffer), { status: 200 });
    }) as typeof fetch;
    const run = m.queue.legeLaufAn({});
    const p = new m.brave.BraveSearchProvider({ f, schluessel: () => 'KEY', runId: run, kostenProAnfrageMilliCent: 500 });
    expect(await p.suche('"Müller Werkzeugbau" Stuttgart')).toEqual([{ titel: 'Müller Werkzeugbau', url: 'https://www.mueller-werkzeugbau.de/', snippet: 'Werkzeugbau in Stuttgart' }]);
    expect(kopf?.get('x-subscription-token')).toBe('KEY');
    expect(url).toContain('country=DE');
    expect(m.kosten.kostenEinesLaufs(run).gesamtMilliCent).toBe(500);
  });
  it('übersetzt Fehler: kein Schlüssel, Rate-Limit, ungültiger Schlüssel', async () => {
    const status = (s: number) => new m.brave.BraveSearchProvider({ f: (async () => new Response('{}', { status: s })) as typeof fetch, schluessel: () => 'K' });
    await expect(new m.brave.BraveSearchProvider({ schluessel: () => undefined }).suche('x')).rejects.toThrow(/Schlüssel/);
    await expect(status(429).suche('x')).rejects.toMatchObject({ wiederholbar: true });
    await expect(status(401).suche('x')).rejects.toMatchObject({ wiederholbar: false });
    await expect(status(503).suche('x')).rejects.toMatchObject({ wiederholbar: true });
  });
});

// ---------------------------------------------------------------- Domain und Crawl

const IMPRESSUM = `<html><body><h1>Impressum</h1><p>Müller Werkzeugbau GmbH<br>Industriestraße 4<br>70469 Stuttgart</p>
<p>Registergericht: Amtsgericht Stuttgart<br>Handelsregisternummer: HRB 100001</p><p>USt-IdNr.: DE 123 456 789</p>
<p>Geschäftsführer: Dr. Hans Müller</p></body></html>`;
const START = `<html><body><nav><a href="/impressum">Impressum</a><a href="/kontakt">Kontakt</a><a href="/team">Team</a></nav>
<h1>Müller Werkzeugbau</h1><p>Wir fertigen Stanz- und Umformwerkzeuge für die Automobilindustrie.</p></body></html>`;
const KONTAKT = `<html><body><p>Telefon: 0711 1234567<br>Fax: 0711 1234568</p><p>Mail: info@mueller-werkzeugbau.de</p></body></html>`;
const TEAM = `<html><body><h2>Ihre Ansprechpartner</h2><p>Dr. Hans Müller, Geschäftsführer<br>Tel. 0711 1234569 · h.mueller@mueller-werkzeugbau.de</p>
<p>Anna Schmidt-Meier, Leiterin Einkauf<br>a.schmidt-meier@mueller-werkzeugbau.de</p></body></html>`;

const WEB: Record<string, string> = {
  'https://www.mueller-werkzeugbau.de/': START,
  'https://www.mueller-werkzeugbau.de/impressum': IMPRESSUM,
  'https://www.mueller-werkzeugbau.de/kontakt': KONTAKT,
  'https://www.mueller-werkzeugbau.de/team': TEAM,
  'https://fremde-firma.de/': '<a href="/impressum">Impressum</a>',
  'https://fremde-firma.de/impressum': '<p>Ganz andere Firma AG, 10115 Berlin</p>',
};

function legeFirmaAn(nummer = '100001') {
  const db = m.db.getDb();
  return db
    .insert(m.db.schema.companies)
    .values({ name: 'Müller Werkzeugbau', rechtsform: 'GmbH', nameNormalized: 'mueller werkzeugbau', registerKey: `stuttgart|HRB|${nummer}`, plz: '70469', ort: 'Stuttgart', strasse: 'Industriestraße 4' })
    .returning({ id: m.db.schema.companies.id })
    .get().id;
}

describe('Domain-Ermittlung', () => {
  const suche = () =>
    new m.search.FakeSearchProvider(() => [
      { titel: 'Müller Werkzeugbau GmbH Stuttgart - Firmenwissen', url: 'https://www.firmenwissen.de/mueller', snippet: 'Müller Werkzeugbau' },
      { titel: 'Fremde Firma', url: 'https://fremde-firma.de/', snippet: 'irgendwas' },
      { titel: 'Müller Werkzeugbau', url: 'https://www.mueller-werkzeugbau.de/produkte', snippet: 'Müller Werkzeugbau GmbH, Stuttgart' },
    ]);

  it('verwirft Verzeichnisse, prüft Kandidaten per Impressum und findet die richtige Domain über die Registernummer', async () => {
    const web = fakeWeb(WEB);
    const { fetcher } = neuerFetcher(web.f);
    const ergebnis = await m.domain.findeDomain({ name: 'Müller Werkzeugbau', nameNormalized: 'mueller werkzeugbau', ort: 'Stuttgart', plz: '70469', registerArt: 'HRB', registerNummer: '100001' }, suche(), fetcher);
    expect(ergebnis).toMatchObject({ domain: 'mueller-werkzeugbau.de', beleg: 'registernummer', konfidenz: 0.98 });
    expect(web.abrufe.some((u) => u.includes('firmenwissen'))).toBe(false);
  });

  it('gibt null zurück, wenn kein Impressum die Firma nennt (lieber keine Domain als eine falsche)', async () => {
    const web = fakeWeb(WEB);
    const { fetcher } = neuerFetcher(web.f);
    const s = new m.search.FakeSearchProvider(() => [{ titel: 'Fremde Firma', url: 'https://fremde-firma.de/', snippet: '' }]);
    expect(await m.domain.findeDomain({ name: 'Müller Werkzeugbau', nameNormalized: 'mueller werkzeugbau', ort: 'Stuttgart' }, s, fetcher)).toBeNull();
  });

  it('akzeptiert bei fehlender Registernummer den Firmennamen im Impressum (mit PLZ stärker)', () => {
    const t = 'Müller Werkzeugbau GmbH, 70469 Stuttgart';
    expect(m.domain.pruefeImpressum(t, { name: 'x', nameNormalized: 'mueller werkzeugbau', ort: null, plz: '70469' })).toMatchObject({ beleg: 'firmenname_und_plz' });
    expect(m.domain.pruefeImpressum(t, { name: 'x', nameNormalized: 'mueller werkzeugbau', ort: null })).toMatchObject({ beleg: 'firmenname', konfidenz: 0.85 });
    expect(m.domain.pruefeImpressum('Mueller Formenbau GmbH', { name: 'x', nameNormalized: 'mueller werkzeugbau', ort: null })).toBeNull();
  });

  it('Domain-Stufe speichert Domain, Beleg und Blocking-Schlüssel; zweiter Aufruf sucht nicht erneut', async () => {
    const id = legeFirmaAn('100003');
    const web = fakeWeb(WEB);
    const s = suche();
    const deps = { suche: s, fetcher: neuerFetcher(web.f).fetcher };
    // Die Registernummer dieser Firma (100003) steht nicht im Impressum, Name und PLZ schon
    expect(await m.web.ermittleDomain(id, deps)).toMatchObject({ status: 'gefunden', domain: 'mueller-werkzeugbau.de', beleg: 'firmenname_und_plz' });
    const anfragen = s.anfragen.length;
    expect(await m.web.ermittleDomain(id, deps)).toMatchObject({ status: 'schon_vorhanden' });
    expect(s.anfragen.length).toBe(anfragen);
    const db = m.db.getDb();
    expect(db.select().from(m.db.schema.companyBlocks).all().some((b) => b.companyId === id && b.schluessel === 'dom|mueller-werkzeugbau.de')).toBe(true);
    expect(db.select().from(m.db.schema.companies).all().find((c) => c.id === id)?.domain).toBe('mueller-werkzeugbau.de');
  });
});

// Antworten des Fake-LLM für die Personenextraktion: enthält bewusst erfundene Werte
const llm = (schema: string, text: string) => {
  if (schema === 'branche') return { branche: 'werkzeugbau', konfidenz: 0.9, beleg: 'Wir fertigen Stanz- und Umformwerkzeuge für die Automobilindustrie.' };
  if (!text.includes('Ansprechpartner')) {
    return { personen: [], telefone: [{ nummer: '0711 1234567', art: 'zentrale' }, { nummer: '0711 9999999', art: 'zentrale' }] };
  }
  return {
    personen: [
      { vorname: 'Hans', nachname: 'Müller', rolle: 'Geschäftsführer', email: 'h.mueller@mueller-werkzeugbau.de', telefon: '0711 1234569', telefonArt: 'durchwahl' },
      { vorname: 'Anna', nachname: 'Schmidt-Meier', rolle: 'Leiterin Einkauf', email: 'a.schmidt-meier@mueller-werkzeugbau.de', telefon: null, telefonArt: null },
      // Erfunden: Name steht nicht im Text
      { vorname: 'Thomas', nachname: 'Schneider', rolle: 'Geschäftsführer', email: 'ts@mueller-werkzeugbau.de', telefon: null, telefonArt: null },
      // Name steht im Text, aber die Rolle nicht („Leiter Fertigung“ wurde erfunden)
      { vorname: 'Hans', nachname: 'Müller', rolle: 'Leiter Fertigung', email: null, telefon: null, telefonArt: null },
    ],
    telefone: [],
  };
};

describe('Crawl und Extraktion (getrennt, Extraktion ohne Neu-Crawl wiederholbar)', () => {
  let companyId: number;
  let abrufeNachCrawl = 0;
  const web = fakeWeb(WEB);

  it('crawlt Startseite, Impressum, Kontakt und Team und speichert die Rohseiten', async () => {
    companyId = legeFirmaAn('100002');
    const db = m.db.getDb();
    db.insert(m.db.schema.domains).values({ companyId, domain: 'mueller-werkzeugbau.de', startUrl: 'https://www.mueller-werkzeugbau.de/', verifiziert: true, beleg: 'registernummer', konfidenz: 0.98 }).run();
    const r = await m.web.crawleFirma(companyId, { fetcher: neuerFetcher(web.f).fetcher });
    expect(r).toMatchObject({ startseite: true, seiten: 4, robots: 0, fehler: 0 });
    const seiten = db.select().from(m.db.schema.crawlPages).all().filter((p) => p.companyId === companyId);
    expect(seiten.map((p) => p.art).sort()).toEqual(['impressum', 'kontakt', 'start', 'team']);
    abrufeNachCrawl = web.abrufe.length;
  });

  it('extrahiert deterministisch und ordnet per LLM zu; Erfundenes wird durch das Grounding verworfen', async () => {
    const fake = new m.prov.FakeExtractionProvider(llm);
    const erg = await m.run.extrahiereFirma(companyId, { extraktion: fake });
    // Hans Müller (Geschäftsführer) und Anna Schmidt-Meier; Thomas Schneider und „Leiter Fertigung“ verworfen
    expect(erg).toMatchObject({ personen: 2, branche: 'werkzeugbau' });
    expect(erg.verworfen).toBeGreaterThanOrEqual(3);
    const db = m.db.getDb();
    const obs = db.select().from(m.db.schema.attributeObservations).all().filter((o) => o.extraktionRunId === erg.runId);
    const personen = obs.filter((o) => o.feld === 'person').map((o) => (o.wert as { nachname: string; rolle: string }));
    expect(personen).toEqual([
      expect.objectContaining({ nachname: 'Müller', rolle: 'geschaeftsfuehrer' }),
      expect.objectContaining({ nachname: 'Schmidt-Meier', rolle: 'sonstige' }),
    ]);
    // Personenbezogene E-Mail landet an der Person, allgemeine E-Mail an der Firma
    expect(obs.some((o) => o.entityType === 'person' && o.feld === 'email' && (o.wert as { adresse: string }).adresse === 'h.mueller@mueller-werkzeugbau.de')).toBe(true);
    expect(obs.some((o) => o.entityType === 'company' && o.feld === 'email' && (o.wert as { adresse: string }).adresse === 'info@mueller-werkzeugbau.de')).toBe(true);
    // Fax wird nicht als Telefon-Zentrale verbucht, die erfundene Nummer verworfen
    const tel = obs.filter((o) => o.entityType === 'company' && o.feld === 'telefon').map((o) => o.wert as { e164: string; art: string });
    expect(tel.find((t) => t.e164 === '+497111234568')?.art).toBe('fax');
    expect(tel.some((t) => t.e164 === '+497119999999')).toBe(false);
    expect(obs.find((o) => o.feld === 'ust_idnr')?.wert).toBe('DE123456789');
    expect(obs.find((o) => o.feld === 'branche_web')).toBeTruthy();
    // Person wurde der Firma zugeordnet (stabile person_id)
    expect(db.select().from(m.db.schema.persons).all().filter((p) => p.companyId === companyId).map((p) => p.nachname).sort()).toEqual(['Müller', 'Schmidt-Meier']);
  });

  it('verwirft Branchen-Antworten ohne belegtes Zitat', async () => {
    const fake = new m.prov.FakeExtractionProvider((s, t) => (s === 'branche' ? { branche: 'formenbau', konfidenz: 0.95, beleg: 'Wir bauen die besten Formen der Welt' } : llm(s, t)));
    const erg = await m.run.extrahiereFirma(companyId, { extraktion: fake });
    expect(erg.branche).toBeNull();
  });

  it('Re-Extraktion braucht keinen neuen Abruf, neuer Lauf, gleiche Personen (idempotent)', async () => {
    const vorher = m.db.getDb().select().from(m.db.schema.persons).all().filter((p) => p.companyId === companyId).length;
    const erg = await m.run.extrahiereFirma(companyId, { extraktion: new m.prov.FakeExtractionProvider(llm) });
    expect(web.abrufe.length).toBe(abrufeNachCrawl);
    expect(m.db.getDb().select().from(m.db.schema.persons).all().filter((p) => p.companyId === companyId)).toHaveLength(vorher);
    expect(erg.runId).toBeGreaterThan(1);
  });

  it('Extraktion ohne gecrawlte Seiten meldet einen klaren Fehler', async () => {
    await expect(m.run.extrahiereFirma(legeFirmaAnOhneSeiten(), { extraktion: new m.prov.FakeExtractionProvider(llm) })).rejects.toThrow(/Crawling/);
  });
});

function legeFirmaAnOhneSeiten(): number {
  return m.db.getDb().insert(m.db.schema.companies).values({ name: 'Leer', nameNormalized: 'leer' }).returning({ id: m.db.schema.companies.id }).get().id;
}

describe('OpenAI-ExtractionProvider', () => {
  const schema = (n: string) => ({ name: n, anweisung: 'Teste', json: { type: 'object' }, parse: (r: unknown) => r as { ok: boolean } });
  it('ruft den Client mit Modell und Schema auf, protokolliert Kosten und liefert das geprüfte Ergebnis', async () => {
    const run = m.queue.legeLaufAn({});
    let angefragt: { modell: string; system: string; schema: unknown } | null = null;
    const p = new m.oai.OpenAiExtractionProvider({ modell: 'klein-1', runId: run, client: async (a) => { angefragt = a; return '{"ok":true}'; } });
    expect(await p.extract('Text', schema('t'))).toEqual({ ok: true });
    expect(angefragt).toMatchObject({ modell: 'klein-1', schema: { type: 'object' } });
    expect(angefragt!.system).toContain('WÖRTLICH');
    expect(m.kosten.kostenEinesLaufs(run).nachAnbieter[0]).toMatchObject({ anbieter: 'openai', art: 'extraktion:t' });
  });
  it('übersetzt ungültiges JSON und KI-Fehler', async () => {
    const kaputt = new m.oai.OpenAiExtractionProvider({ modell: 'k', client: async () => 'kein json' });
    await expect(kaputt.extract('x', schema('t'))).rejects.toBeInstanceOf(m.prov.ExtraktionFehler);
    const { KiFehler } = await import('@/lib/ki');
    const limit = new m.oai.OpenAiExtractionProvider({ modell: 'k', client: async () => { throw new KiFehler('Rate-Limit', 'limit', true); } });
    await expect(limit.extract('x', schema('t'))).rejects.toMatchObject({ wiederholbar: true });
  });
});
