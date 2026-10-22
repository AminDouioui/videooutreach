import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { jaro, jaroWinkler } from './resolve/jaro-winkler';
import { blockingSchluessel, namensAehnlichkeit, normalisiereDomain, personenSchluessel, vergleicheFirmen, vergleichePersonen, type FirmaMerkmale } from './resolve/match';

describe('Jaro-Winkler (Referenzwerte der Literatur)', () => {
  it('stimmt mit bekannten Werten überein', () => {
    expect(jaro('MARTHA', 'MARHTA')).toBeCloseTo(0.9444, 3);
    expect(jaroWinkler('MARTHA', 'MARHTA')).toBeCloseTo(0.9611, 3);
    expect(jaroWinkler('DWAYNE', 'DUANE')).toBeCloseTo(0.84, 2);
    expect(jaroWinkler('DIXON', 'DICKSONX')).toBeCloseTo(0.8133, 3);
  });
  it('behandelt Randfälle', () => {
    expect(jaroWinkler('', '')).toBe(1);
    expect(jaroWinkler('a', '')).toBe(0);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
    expect(jaroWinkler('mueller', 'mueller')).toBe(1);
  });
});

const firma = (p: Partial<FirmaMerkmale> & { nameNormalized: string }): FirmaMerkmale => ({ registerKey: null, plz: null, ort: null, strasse: null, domain: null, ...p });

describe('Firmenvergleich', () => {
  it('Registernummer und Gericht sind ein harter Match, unabhängig vom Namen', () => {
    const r = vergleicheFirmen(firma({ nameNormalized: 'alpha', registerKey: 'stuttgart|HRB|1' }), firma({ nameNormalized: 'ganz anders', registerKey: 'stuttgart|HRB|1' }));
    expect(r).toMatchObject({ score: 1, entscheidung: 'sicher' });
  });
  it('verschiedene Registerschlüssel schließen den Match hart aus, auch bei gleichem Namen und gleicher Adresse', () => {
    const basis = { nameNormalized: 'mueller werkzeugbau', plz: '70469', strasse: 'Industriestraße 4', ort: 'Stuttgart' };
    expect(vergleicheFirmen(firma({ ...basis, registerKey: 'stuttgart|HRB|1' }), firma({ ...basis, registerKey: 'stuttgart|HRB|2' }))).toMatchObject({ score: 0, entscheidung: 'getrennt' });
  });
  it('gleicher Name, gleiche Adresse ohne Register: sicher', () => {
    const a = firma({ nameNormalized: 'probe maschinenbau', plz: '40213', strasse: 'Rheinallee 1', ort: 'Düsseldorf' });
    expect(vergleicheFirmen(a, { ...a, strasse: 'Rheinallee 1' }).entscheidung).toBe('sicher');
  });
  it('tolerant gegen Tippfehler und Straßenschreibweise', () => {
    const a = firma({ nameNormalized: 'mueller werkzeugbau', plz: '70469', strasse: 'Industriestraße 4', ort: 'Stuttgart' });
    const b = firma({ nameNormalized: 'mueller werkzeugbaw', plz: '70469', strasse: 'Industriestrasse 4', ort: 'Stuttgart' });
    expect(vergleicheFirmen(a, b).entscheidung).toBe('sicher');
  });
  it('gleicher Name, andere Straße im selben PLZ-Gebiet: zur Prüfung, nicht automatisch', () => {
    const a = firma({ nameNormalized: 'probe maschinenbau', plz: '40213', strasse: 'Rheinallee 1', ort: 'Düsseldorf' });
    const r = vergleicheFirmen(a, { ...a, strasse: 'Königsallee 5' });
    expect(r.entscheidung).toBe('unsicher');
  });
  it('ähnlicher, aber verschiedener Name (Formenbau/Werkzeugbau) wird getrennt', () => {
    const a = firma({ nameNormalized: 'mueller werkzeugbau', plz: '70469', strasse: 'Industriestraße 4', ort: 'Stuttgart' });
    const b = firma({ nameNormalized: 'mueller formenbau', plz: '70469', strasse: 'Industriestraße 4', ort: 'Stuttgart' });
    expect(namensAehnlichkeit(a.nameNormalized, b.nameNormalized)).toBeLessThan(0.8);
    expect(vergleicheFirmen(a, b).entscheidung).not.toBe('sicher');
  });
  it('gleiche Domain bestätigt eine sonst unsichere Zuordnung', () => {
    const a = firma({ nameNormalized: 'probe maschinenbau', plz: '40213', strasse: 'Rheinallee 1', domain: 'probe-maschinenbau.de' });
    const b = firma({ nameNormalized: 'probe maschinenbau service', plz: '40213', strasse: 'Rheinallee 1', domain: 'www.Probe-Maschinenbau.de' });
    expect(vergleicheFirmen(a, b).entscheidung).toBe('sicher');
  });
  it('wenig Merkmale dämpfen den Score (nur Name reicht nie für „sicher“)', () => {
    const r = vergleicheFirmen(firma({ nameNormalized: 'probe maschinenbau' }), firma({ nameNormalized: 'probe maschinenbau' }));
    expect(r.entscheidung).not.toBe('sicher');
  });
});

describe('Blocking und Domain', () => {
  it('bildet Schlüssel aus Register, Domain und PLZ + Namenswort', () => {
    const keys = blockingSchluessel({ nameNormalized: 'mueller werkzeugbau und co', registerKey: 'stuttgart|HRB|1', plz: '70469', domain: 'https://www.Mueller.de/impressum' });
    expect(keys).toEqual(expect.arrayContaining(['reg|stuttgart|HRB|1', 'dom|mueller.de', 'plz|70469|mueller', 'plz|70469|werkzeugbau']));
    // Füllwörter und kurze Wörter blockieren nichts
    expect(keys.some((k) => k.endsWith('|und') || k.endsWith('|co'))).toBe(false);
  });
  it('ohne PLZ und ohne Register gibt es keinen Block (kein Vergleich mit allen Firmen)', () => {
    expect(blockingSchluessel({ nameNormalized: 'mueller', registerKey: null, plz: null, domain: null })).toEqual([]);
  });
  it('normalisiert Domains', () => {
    expect(normalisiereDomain('HTTP://WWW.Firma.de/kontakt')).toBe('firma.de');
    expect(normalisiereDomain('keine domain')).toBeNull();
  });
});

describe('Personenvergleich', () => {
  it('„Hans Müller“ und „Müller, Hans“ sind dieselbe Person', () => {
    expect(vergleichePersonen({ vorname: 'Hans', nachname: 'Müller' }, { vorname: 'Hans', nachname: 'Mueller' }).entscheidung).toBe('sicher');
  });
  it('Initial gegen Vorname: sicher oder unsicher, aber nicht getrennt', () => {
    expect(vergleichePersonen({ vorname: 'H.', nachname: 'Müller' }, { vorname: 'Hans', nachname: 'Müller' }).entscheidung).not.toBe('getrennt');
  });
  it('verschiedene Vornamen werden nie automatisch zusammengeführt', () => {
    expect(vergleichePersonen({ vorname: 'Hans', nachname: 'Müller' }, { vorname: 'Hanna', nachname: 'Müller' }).entscheidung).not.toBe('sicher');
    expect(vergleichePersonen({ vorname: 'Peter', nachname: 'Müller' }, { vorname: 'Anna', nachname: 'Müller' }).entscheidung).toBe('getrennt');
  });
  it('fehlender Vorname reicht nicht für „sicher“', () => {
    expect(vergleichePersonen({ vorname: null, nachname: 'Müller' }, { vorname: 'Hans', nachname: 'Müller' }).entscheidung).toBe('unsicher');
  });
  it('bildet einen stabilen Schlüssel', () => {
    expect(personenSchluessel({ vorname: 'Hans', nachname: 'Müller' })).toBe('mueller|hans');
  });
});

// ---------------------------------------------------------------- Datenbank

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-resolve-'));
Object.assign(process.env, { DATA_DIR: dir, ADMIN_PASSWORD: 'x', SESSION_SECRET: 'x'.repeat(32), ENCRYPTION_KEY: '0'.repeat(64), IP_HASH_SALT: 's' });
const FIXTURE = path.resolve(process.cwd(), 'test/fixtures/leadgen/offeneregister-beispiel.jsonl');

type Mod = {
  db: typeof import('@/lib/db');
  ingest: typeof import('./ingest');
  oreg: typeof import('./connectors/offeneregister');
  res: typeof import('./resolve/resolve');
  types: typeof import('./types');
};
let m: Mod;

function satz(q: string, ref: string, s: Partial<import('./types').NormalisierterSatz> & { name: string }): import('./types').RawDocument {
  const voll: import('./types').NormalisierterSatz = {
    quelle: q, referenz: ref, rechtsform: null, nameNormalized: s.name.toLowerCase(), registerart: null, registernummer: null, registergericht: null, sitz: null, adresse: null, status: null, personen: [], ...s,
  };
  return { quelle: q, referenz: ref, inhalt: JSON.stringify(voll) };
}
const adresse = (strasse: string, plz: string, ort: string) => ({ strasse, plz, ort, bundesland: null, bundeslandHerkunft: null });
const person = (vorname: string | null, nachname: string, rolle: import('./types').PersonenRolle = 'geschaeftsfuehrer') => ({ vorname, nachname, titel: [], rolle, rolleOriginal: null });

async function ingestSaetze(docs: import('./types').RawDocument[]) {
  await m.ingest.ingestQuelle({ quelle: docs[0].quelle, async *fetch() { yield* docs; } }, m.db.getDb(), (d) => JSON.parse(d.inhalt));
}

beforeAll(async () => {
  m = { db: await import('@/lib/db'), ingest: await import('./ingest'), oreg: await import('./connectors/offeneregister'), res: await import('./resolve/resolve'), types: await import('./types') };
  m.db.getDb();
});

describe('Entity Resolution mit Datenbank', () => {
  it('Seed: 20 Firmen aus dem Register ergeben 20 Firmen und 21 Personen, ohne Zusammenführung', async () => {
    await m.ingest.ingestQuelle(new m.oreg.OffeneRegisterConnector({ datei: FIXTURE }));
    const erg = m.res.loeseEntitaetenAuf();
    expect(erg).toMatchObject({ dokumente: 20, neueFirmen: 20, zusammengefuehrt: 0, zurPruefung: 0, neuePersonen: 21 });
    expect(m.res.ladeResolutionKennzahlen()).toEqual({ quellsaetze: 20, firmen: 20, offenePruefFaelle: 0, personen: 21 });
    // Alle Beobachtungen haben jetzt eine entity_id
    const ohne = m.db.getDb().select().from(m.db.schema.attributeObservations).all().filter((o) => o.entityId === null);
    expect(ohne).toHaveLength(0);
  });

  it('ist idempotent: zweiter Lauf ändert nichts', () => {
    expect(m.res.loeseEntitaetenAuf()).toMatchObject({ dokumente: 0, neueFirmen: 0, zusammengefuehrt: 0 });
    expect(m.res.ladeResolutionKennzahlen().firmen).toBe(20);
  });

  it('führt eine zweite Quelle über die Registernummer zusammen (anderer Name, andere Schreibweise)', async () => {
    const vorher = m.db.getDb().select().from(m.db.schema.companies).all().find((c) => c.registerKey === 'stuttgart|HRB|100001')!;
    await ingestSaetze([
      satz('zweitquelle', 'ZQ-1', {
        name: 'BEISPIEL WERKZEUGBAU', nameNormalized: 'beispiel werkzeugbau', registerart: 'HRB', registernummer: '100001', registergericht: 'Stuttgart',
        adresse: adresse('Industriestr. 4', '70469', 'Stuttgart'), personen: [person('Hans', 'Mueller'), person('Erika', 'Neu', 'prokurist')],
      }),
    ]);
    const erg = m.res.loeseEntitaetenAuf();
    expect(erg).toMatchObject({ dokumente: 1, neueFirmen: 0, zusammengefuehrt: 1, neuePersonen: 1, personenZusammengefuehrt: 1 });
    const map = m.db.getDb().select().from(m.db.schema.entityMap).all().find((e) => e.quelle === 'zweitquelle' && e.entityType === 'company')!;
    // Dieselbe stabile company_id wie im Registerseed
    expect(map).toMatchObject({ entityId: vorher.id, status: 'sicher', matchScore: 1 });
    expect(m.res.ladeResolutionKennzahlen().firmen).toBe(20);
    // Beobachtungen der zweiten Quelle hängen an der gemeinsamen Firma
    const obs = m.db.getDb().select().from(m.db.schema.attributeObservations).all().filter((o) => o.quelle === 'zweitquelle' && o.entityType === 'company');
    expect(obs.length).toBeGreaterThan(0);
    expect(obs.every((o) => o.entityId === vorher.id)).toBe(true);
  });

  it('führt ohne Registernummer über Name, Adresse und PLZ zusammen', async () => {
    await ingestSaetze([
      satz('drittquelle', 'DQ-1', { name: 'Probe Maschinenbau', nameNormalized: 'probe maschinenbau', adresse: adresse('Rheinallee 1', '40213', 'Düsseldorf'), personen: [person('Klaus', 'von der Heide', 'vorstand')] }),
    ]);
    expect(m.res.loeseEntitaetenAuf()).toMatchObject({ zusammengefuehrt: 1, neueFirmen: 0, personenZusammengefuehrt: 1 });
  });

  it('legt gleichnamige Firma in anderer Stadt getrennt an, ohne Prüfung', async () => {
    await ingestSaetze([satz('viertquelle', 'VQ-1', { name: 'Probe Maschinenbau', nameNormalized: 'probe maschinenbau', adresse: adresse('Marienplatz 1', '80331', 'München') })]);
    expect(m.res.loeseEntitaetenAuf()).toMatchObject({ neueFirmen: 1, zusammengefuehrt: 0, zurPruefung: 0 });
  });

  it('gleicher Name und gleiche Adresse, aber verschiedene Registernummer: getrennt', async () => {
    await ingestSaetze([
      satz('fuenftquelle', 'FQ-1', {
        name: 'Beispiel Werkzeugbau', nameNormalized: 'beispiel werkzeugbau', registerart: 'HRB', registernummer: '999999', registergericht: 'Stuttgart', adresse: adresse('Industriestraße 4', '70469', 'Stuttgart'),
      }),
    ]);
    expect(m.res.loeseEntitaetenAuf()).toMatchObject({ neueFirmen: 1, zusammengefuehrt: 0, zurPruefung: 0 });
  });

  let reviewId: number;
  it('markiert unsichere Paare zur manuellen Prüfung und legt dafür eine eigene Firma an', async () => {
    const vorher = m.res.ladeResolutionKennzahlen();
    await ingestSaetze([
      satz('sechstquelle', 'SQ-1', { name: 'Probe Maschinenbau', nameNormalized: 'probe maschinenbau', adresse: adresse('Königsallee 5', '40213', 'Düsseldorf'), personen: [person('Klaus', 'von der Heide'), person('Lisa', 'Neu')] }),
    ]);
    expect(m.res.loeseEntitaetenAuf()).toMatchObject({ neueFirmen: 1, zusammengefuehrt: 0, zurPruefung: 1, neuePersonen: 2 });
    const k = m.res.ladeResolutionKennzahlen();
    expect(k.firmen).toBe(vorher.firmen + 1);
    expect(k.offenePruefFaelle).toBe(1);
    const fall = m.res.offenePruefFaelle()[0];
    expect(fall.score).toBeGreaterThanOrEqual(0.8);
    reviewId = fall.id;
  });

  it('nachgezogene neue Version einer bekannten Quelle erbt die Firma ohne neuen Vergleich', async () => {
    await ingestSaetze([satz('drittquelle', 'DQ-1', { name: 'Probe Maschinenbau', nameNormalized: 'probe maschinenbau', adresse: adresse('Rheinallee 1', '40213', 'Düsseldorf'), personen: [person('Klaus', 'von der Heide', 'vorstand')], status: 'geändert' })]);
    expect(m.res.loeseEntitaetenAuf()).toMatchObject({ dokumente: 1, versionenNachgezogen: 1, neueFirmen: 0, zusammengefuehrt: 0 });
  });

  it('Prüfer bestätigt: Firmen werden zusammengeführt, die id der Kandidatin bleibt, Personen werden dedupliziert', () => {
    const db = m.db.getDb();
    const fall = db.select().from(m.db.schema.matchReview).all().find((r) => r.id === reviewId)!;
    const vorher = m.res.ladeResolutionKennzahlen();
    m.res.bestaetigeMatch(reviewId);
    const nachher = m.res.ladeResolutionKennzahlen();
    expect(nachher.firmen).toBe(vorher.firmen - 1);
    expect(nachher.offenePruefFaelle).toBe(0);
    // „Klaus von der Heide“ gab es doppelt und ist jetzt eine Person; „Lisa Neu“ kommt neu dazu
    const personen = db.select().from(m.db.schema.persons).all().filter((p) => p.companyId === fall.kandidatId);
    expect(personen.map((p) => p.nachname).sort()).toEqual(['Neu', 'Roth', 'von der Heide']);
    // Die Zuordnung der sechsten Quelle zeigt auf die Kandidatin
    const map = db.select().from(m.db.schema.entityMap).all().find((e) => e.quelle === 'sechstquelle' && e.entityType === 'company')!;
    expect(map).toMatchObject({ entityId: fall.kandidatId, status: 'manuell' });
    expect(db.select().from(m.db.schema.companies).all().some((c) => c.id === fall.companyId)).toBe(false);
    expect(() => m.res.bestaetigeMatch(reviewId)).toThrow(/bereits entschieden/);
  });

  it('Prüfer lehnt ab: Firmen bleiben getrennt und der Fall ist erledigt', async () => {
    await ingestSaetze([satz('siebtquelle', 'SB-1', { name: 'Probe Maschinenbau', nameNormalized: 'probe maschinenbau', adresse: adresse('Graf-Adolf-Platz 9', '40213', 'Düsseldorf') })]);
    m.res.loeseEntitaetenAuf();
    const fall = m.res.offenePruefFaelle()[0];
    const firmen = m.res.ladeResolutionKennzahlen().firmen;
    m.res.lehneMatchAb(fall.id);
    expect(m.res.offenePruefFaelle()).toHaveLength(0);
    expect(m.res.ladeResolutionKennzahlen().firmen).toBe(firmen);
    expect(() => m.res.lehneMatchAb(fall.id)).toThrow();
  });

  it('Kennzahl nach Phase 2: Quellsätze, Firmen (eindeutig), offene Prüffälle', () => {
    const k = m.res.ladeResolutionKennzahlen();
    // 20 Register + 6 weitere Quellsätze mit 3 Zusammenführungen (Register-Match, Name/Adresse, bestätigter Prüffall)
    expect(k.quellsaetze).toBe(26);
    expect(k.firmen).toBe(23);
    expect(k.offenePruefFaelle).toBe(0);
  });
});
