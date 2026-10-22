import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { extrahiereMitarbeiter } from '../extract/deterministic';
import { berechneDatenScore, berechneIcpScore, klassenUeberlappung, type GoldenFirma } from '../score';
import { STANDARD_ICP } from '../config';
import { aktuelleBeobachtungen, hgbKlasseVonZahl, mitarbeiterKlasse, mitDecay, quellenRang, waehleGewinner, type Beobachtung } from './survivorship';

const TAG = 86_400_000;
const JETZT = Date.UTC(2026, 9, 22);
let id = 0;
const b = (feld: string, wert: unknown, quelle: string, p: Partial<Beobachtung> = {}): Beobachtung => ({ id: ++id, feld, wert, quelle, konfidenz: 0.8, typ: 'exakt', beobachtetAm: JETZT - 10 * TAG, ...p });

describe('Survivorship', () => {
  it('Register schlägt Webseite bei den Stammdaten', () => {
    const g = waehleGewinner('name', [b('name', 'Müller Werkzeugbau', 'web'), b('name', 'Mueller Werkzeugbau', 'handelsregister', { beobachtetAm: JETZT - 400 * TAG })], JETZT)!;
    expect(g).toMatchObject({ wert: 'Mueller Werkzeugbau', quelle: 'handelsregister' });
  });
  it('Bei der Adresse schlägt die aktuelle Webseite den alten OffeneRegister-Seed (nie als Wahrheit)', () => {
    const g = waehleGewinner('strasse', [b('strasse', 'Alte Str. 1', 'offeneregister', { beobachtetAm: JETZT - 2500 * TAG }), b('strasse', 'Neue Str. 5', 'web')], JETZT)!;
    expect(g.wert).toBe('Neue Str. 5');
    // ... aber das echte Handelsregister schlägt beide
    expect(waehleGewinner('strasse', [b('strasse', 'Register Str. 9', 'handelsregister'), b('strasse', 'Neue Str. 5', 'web')], JETZT)!.wert).toBe('Register Str. 9');
  });
  it('bei gleicher Quelle schlägt neu alt, unabhängig von der Konfidenz', () => {
    const g = waehleGewinner('ort', [b('ort', 'Alt', 'web', { beobachtetAm: JETZT - 300 * TAG, konfidenz: 0.95 }), b('ort', 'Neu', 'web', { beobachtetAm: JETZT - 5 * TAG, konfidenz: 0.6 })], JETZT)!;
    expect(g.wert).toBe('Neu');
  });
  it('bei Gleichstand von Quelle und Zeit gewinnt die höhere (zerfallene) Konfidenz', () => {
    const g = waehleGewinner('ort', [b('ort', 'A', 'web', { konfidenz: 0.6 }), b('ort', 'B', 'web', { konfidenz: 0.9 })], JETZT)!;
    expect(g.wert).toBe('B');
  });
  it('Mitarbeiterzahl: exakt (Bundesanzeiger) schlägt Schätzung, auch wenn die Schätzung neuer ist', () => {
    const g = waehleGewinner(
      'mitarbeiter',
      [b('mitarbeiter', { zahl: 180 }, 'web', { typ: 'schaetzung', beobachtetAm: JETZT - 2 * TAG }), b('mitarbeiter', { zahl: 230 }, 'bundesanzeiger', { typ: 'exakt', beobachtetAm: JETZT - 500 * TAG })],
      JETZT,
    )!;
    expect(g).toMatchObject({ wert: { zahl: 230 }, quelle: 'bundesanzeiger', typ: 'exakt' });
  });
  it('Mitarbeiterzahl: Größenklasse schlägt Schätzung, exakt schlägt Klasse', () => {
    const klasse = b('mitarbeiter', { klasse: 'hgb_mittel' }, 'bundesanzeiger', { typ: 'klasse' });
    const schaetz = b('mitarbeiter', { zahl: 300 }, 'web', { typ: 'schaetzung' });
    const exakt = b('mitarbeiter', { zahl: 120 }, 'northdata', { typ: 'exakt' });
    expect(waehleGewinner('mitarbeiter', [schaetz, klasse], JETZT)!.typ).toBe('klasse');
    expect(waehleGewinner('mitarbeiter', [schaetz, klasse, exakt], JETZT)!.typ).toBe('exakt');
  });
  it('ignoriert leere Werte und unbekannte Felder', () => {
    expect(waehleGewinner('name', [b('name', '', 'web'), b('name', null, 'handelsregister')], JETZT)).toBeNull();
    expect(waehleGewinner('gibt_es_nicht', [b('gibt_es_nicht', 'x', 'web')], JETZT)).toBeNull();
    expect(waehleGewinner('name', [], JETZT)).toBeNull();
  });
  it('unbekannte Quellen stehen hinter allen bekannten, Präfix „suche:“ gilt für alle Suchquellen', () => {
    expect(quellenRang('person', 'suche:netzwerk')).toBe(quellenRang('person', 'suche:presse'));
    expect(quellenRang('person', 'irgendwas')).toBeGreaterThan(quellenRang('person', 'offeneregister'));
    expect(waehleGewinner('domain', [b('domain', 'a.de', 'irgendwas'), b('domain', 'b.de', 'suche:brave')], JETZT)!.wert).toBe('b.de');
  });
  it('ein neuerer Extraktionslauf ersetzt die Beobachtungen des älteren; Beobachtungen ohne Lauf bleiben', () => {
    const liste = [b('x', 1, 'web', { extraktionRunId: 1 }), b('x', 2, 'web', { extraktionRunId: 2 }), b('name', 'R', 'handelsregister')];
    expect(aktuelleBeobachtungen(liste).map((o) => o.wert)).toEqual([2, 'R']);
    expect(aktuelleBeobachtungen([b('x', 1, 'web')])).toHaveLength(1);
  });
});

describe('Decay', () => {
  it('halbiert die Konfidenz je Halbwertszeit des Felds', () => {
    expect(mitDecay(0.8, 'email', JETZT - 90 * TAG, JETZT)).toBeCloseTo(0.4, 5);
    expect(mitDecay(0.8, 'email', JETZT - 180 * TAG, JETZT)).toBeCloseTo(0.2, 5);
    expect(mitDecay(0.8, 'person', JETZT - 365 * TAG, JETZT)).toBeCloseTo(0.4, 5);
    expect(mitDecay(0.8, 'email', JETZT, JETZT)).toBe(0.8);
  });
  it('sinkt nie unter den Mindestanteil und rechnet nie mit der Zukunft', () => {
    expect(mitDecay(1, 'email', JETZT - 10_000 * TAG, JETZT)).toBeCloseTo(0.2, 5);
    expect(mitDecay(0.5, 'email', JETZT + 5 * TAG, JETZT)).toBe(0.5);
  });
  it('E-Mail-Prüfungen verfallen schneller als Registernummern', () => {
    expect(mitDecay(1, 'email_pruefung', JETZT - 60 * TAG, JETZT)).toBeLessThan(mitDecay(1, 'registernummer', JETZT - 60 * TAG, JETZT));
  });
});

describe('Größenklassen', () => {
  it('ordnet Mitarbeiterzahlen unseren Klassen und den HGB-Klassen (§ 267) zu', () => {
    expect([10, 49, 50, 99, 100, 249, 250, 499, 500, 800, 801].map(mitarbeiterKlasse)).toEqual(['<50', '<50', '50-99', '50-99', '100-249', '100-249', '250-499', '250-499', '500-800', '500-800', '>800']);
    expect([50, 51, 250, 251].map(hgbKlasseVonZahl)).toEqual(['hgb_klein', 'hgb_mittel', 'hgb_mittel', 'hgb_gross']);
  });
  it('liest Mitarbeiterzahlen aus Webseitentext', () => {
    expect(extrahiereMitarbeiter('Wir sind ein Familienunternehmen mit über 250 Mitarbeitenden.')).toEqual({ zahl: 250, ungefaehr: true });
    expect(extrahiereMitarbeiter('Rund 1.200 Mitarbeiter weltweit')).toEqual({ zahl: 1200, ungefaehr: true });
    expect(extrahiereMitarbeiter('85 Beschäftigte am Standort')).toEqual({ zahl: 85, ungefaehr: false });
    expect(extrahiereMitarbeiter('Wir suchen 2 Mitarbeiter (m/w/d)')).toBeNull();
    expect(extrahiereMitarbeiter('Keine Angabe')).toBeNull();
  });
});

// ---------------------------------------------------------------- Scoring

const voll = (p: Partial<GoldenFirma> = {}): GoldenFirma => ({
  name: 'Müller Werkzeugbau', strasse: 'Industriestraße 4', plz: '70469', ort: 'Stuttgart', bundesland: 'Baden-Württemberg', rechtsform: 'GmbH', domain: 'mueller.de',
  branche: 'werkzeugbau', brancheKonfidenz: 0.9, mitarbeiterZahl: 230, mitarbeiterTyp: 'exakt', mitarbeiterKlasse: '100-249',
  herkunft: { name: { konfidenz: 0.9, beobachtetAm: JETZT - 5 * TAG }, plz: { konfidenz: 0.9, beobachtetAm: JETZT - 5 * TAG }, domain: { konfidenz: 0.95, beobachtetAm: JETZT - 5 * TAG } },
  person: { konfidenz: 0.85, beobachtetAm: JETZT - 5 * TAG }, email: { status: 'gueltig', konfidenz: 0.95, verifiziertAm: JETZT - 3 * TAG }, telefon: true, ...p,
});
const leer: GoldenFirma = { name: null, strasse: null, plz: null, ort: null, bundesland: null, rechtsform: null, domain: null, branche: null, brancheKonfidenz: null, mitarbeiterZahl: null, mitarbeiterTyp: null, mitarbeiterKlasse: null, herkunft: {}, person: null, email: null, telefon: false };

describe('Datenqualitäts-Score', () => {
  it('ein vollständiger, frischer, verifizierter Lead liegt weit oben, ein leerer bei 0', () => {
    expect(berechneDatenScore(voll(), JETZT).score).toBeGreaterThanOrEqual(90);
    expect(berechneDatenScore(leer, JETZT)).toMatchObject({ score: 0, vollstaendigkeit: 0 });
  });
  it('der E-Mail-Status zählt: gültig > catch-all best guess > generisch', () => {
    const s = (status: string) => berechneDatenScore(voll({ email: { status, konfidenz: 0.4, verifiziertAm: null } }), JETZT).score;
    expect(berechneDatenScore(voll(), JETZT).score).toBeGreaterThan(s('catch_all_best_guess'));
    expect(s('catch_all_best_guess')).toBeGreaterThan(s('generisch_unverifiziert'));
    expect(berechneDatenScore(voll({ email: null }), JETZT).score).toBeLessThan(s('generisch_unverifiziert'));
  });
  it('alte Daten verlieren Aktualität und damit Score', () => {
    const alt = voll({ herkunft: { name: { konfidenz: 0.9, beobachtetAm: JETZT - 3000 * TAG }, plz: { konfidenz: 0.9, beobachtetAm: JETZT - 3000 * TAG } }, person: { konfidenz: 0.85, beobachtetAm: JETZT - 3000 * TAG }, email: { status: 'gueltig', konfidenz: 0.95, verifiziertAm: JETZT - 800 * TAG } });
    expect(berechneDatenScore(alt, JETZT).aktualitaet).toBeLessThan(berechneDatenScore(voll(), JETZT).aktualitaet);
    expect(berechneDatenScore(alt, JETZT).score).toBeLessThan(berechneDatenScore(voll(), JETZT).score);
  });
  it('benennt fehlende Angaben und hat konfigurierbare Gewichte', () => {
    expect(berechneDatenScore(voll({ domain: null, telefon: false }), JETZT).fehlend).toEqual(['domain', 'telefon']);
    const nurEmail = berechneDatenScore(voll(), JETZT, { vollstaendigkeit: 0, konfidenz: 0, email: 1, aktualitaet: 0 });
    expect(nurEmail.score).toBe(100);
  });
});

describe('ICP-Fit', () => {
  it('Werkzeugbau, 230 Mitarbeiter, GmbH ist ein Volltreffer', () => {
    expect(berechneIcpScore(voll()).score).toBeGreaterThanOrEqual(95);
  });
  it('Branche: keine Fertigung drückt den Score stark, Maschinenbau etwas', () => {
    const s = (branche: string) => berechneIcpScore(voll({ branche })).score;
    expect(s('werkzeugbau')).toBeGreaterThan(s('maschinenbau'));
    expect(s('maschinenbau')).toBeGreaterThan(s('sonstige_fertigung'));
    expect(s('sonstige_fertigung')).toBeGreaterThan(s('keine_fertigung'));
    expect(s('keine_fertigung')).toBeLessThan(65);
  });
  it('Mitarbeiter: im Zielbereich 100, darunter und darüber abnehmend, unbekannt neutral-niedrig, Schätzung unsicherer als exakt', () => {
    const ma = (z: number | null, typ: GoldenFirma['mitarbeiterTyp'] = 'exakt') => berechneIcpScore(voll({ mitarbeiterZahl: z, mitarbeiterTyp: typ, mitarbeiterKlasse: null })).mitarbeiter;
    expect(ma(300)).toBe(100);
    expect(ma(100)).toBe(100);
    expect(ma(800)).toBe(100);
    expect(ma(40)).toBeLessThan(ma(90));
    expect(ma(90)).toBeLessThan(100);
    expect(ma(2000)).toBeLessThan(ma(900));
    expect(ma(null)).toBe(30);
    expect(ma(300, 'schaetzung')).toBeLessThan(ma(300, 'exakt'));
  });
  it('Größenklassen werden anteilig mit dem Zielbereich verglichen', () => {
    expect(klassenUeberlappung('100-249', 100, 800)).toBe(1);
    expect(klassenUeberlappung('<50', 100, 800)).toBe(0);
    expect(klassenUeberlappung('hgb_mittel', 100, 800)).toBeCloseTo(151 / 200, 2);
    expect(klassenUeberlappung('unbekannt', 100, 800)).toBeNull();
    const nurKlasse = berechneIcpScore(voll({ mitarbeiterZahl: null, mitarbeiterTyp: 'klasse', mitarbeiterKlasse: 'hgb_klein' }));
    expect(nurKlasse.mitarbeiter).toBeLessThan(50);
  });
  it('Region: Bundesland- oder PLZ-Filter, ohne Filter immer 100, bei unbekannter Region neutral', () => {
    const k = { ...STANDARD_ICP, bundeslaender: ['Bayern'], plzPraefixe: ['70'] };
    expect(berechneIcpScore(voll(), k).region).toBe(100);
    expect(berechneIcpScore(voll({ plz: '80331', bundesland: 'Bayern' }), k).region).toBe(100);
    expect(berechneIcpScore(voll({ plz: '10115', bundesland: 'Berlin' }), k).region).toBe(0);
    expect(berechneIcpScore(voll({ plz: null, bundesland: null }), k).region).toBe(30);
    expect(berechneIcpScore(voll({ plz: '10115', bundesland: 'Berlin' })).region).toBe(100);
  });
  it('Rechtsform und Gewichte sind konfigurierbar', () => {
    expect(berechneIcpScore(voll({ rechtsform: 'GbR' })).rechtsform).toBe(30);
    expect(berechneIcpScore(voll({ rechtsform: null })).rechtsform).toBe(30);
    expect(berechneIcpScore(voll({ rechtsform: 'Exotische Form' })).rechtsform).toBe(50);
    const nurBranche = { ...STANDARD_ICP, gewichte: { branche: 1, mitarbeiter: 0, region: 0, rechtsform: 0 } };
    expect(berechneIcpScore(voll({ branche: 'keine_fertigung', brancheKonfidenz: 1 }), nurBranche).score).toBe(0);
    // Unsichere Branche wird zum neutralen Wert gezogen
    expect(berechneIcpScore(voll({ branche: 'keine_fertigung', brancheKonfidenz: 0.2 }), nurBranche).score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- Golden Record aus der Datenbank

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-golden-'));
Object.assign(process.env, { DATA_DIR: dir, ADMIN_PASSWORD: 'x', SESSION_SECRET: 'x'.repeat(32), ENCRYPTION_KEY: '0'.repeat(64), IP_HASH_SALT: 's' });
const FIXTURE = path.resolve(process.cwd(), 'test/fixtures/leadgen/offeneregister-beispiel.jsonl');

type Mod = {
  db: typeof import('@/lib/db');
  ingest: typeof import('../ingest');
  oreg: typeof import('../connectors/offeneregister');
  res: typeof import('../resolve/resolve');
  rebuild: typeof import('./rebuild');
  fin: typeof import('../contacts/finder');
};
let m: Mod;
beforeAll(async () => {
  m = { db: await import('@/lib/db'), ingest: await import('../ingest'), oreg: await import('../connectors/offeneregister'), res: await import('../resolve/resolve'), rebuild: await import('./rebuild'), fin: await import('../contacts/finder') };
  m.db.getDb();
  await m.ingest.ingestQuelle(new m.oreg.OffeneRegisterConnector({ datei: FIXTURE }));
  m.res.loeseEntitaetenAuf();
});

function obs(companyId: number, feld: string, wert: unknown, quelle: string, extra: { typ?: 'exakt' | 'klasse' | 'schaetzung'; konfidenz?: number; beobachtetAm?: Date; entityType?: 'company' | 'person'; run?: number } = {}) {
  return m.db.getDb().insert(m.db.schema.attributeObservations).values({ entityType: extra.entityType ?? 'company', entityId: companyId, feld, wert, quelle, konfidenz: extra.konfidenz ?? 0.8, typ: extra.typ ?? 'exakt', beobachtetAm: extra.beobachtetAm ?? new Date(JETZT - 5 * TAG), extraktionRunId: extra.run ?? null }).returning({ id: m.db.schema.attributeObservations.id }).get().id;
}
const firmaMitName = (name: string) => m.db.getDb().select().from(m.db.schema.companies).all().find((c) => c.name === name)!;

describe('Golden Record aus Beobachtungen (jederzeit neu berechenbar)', () => {
  it('leitet Firma, Adresse und Herkunft je Feld aus dem Registerseed ab', () => {
    const c = firmaMitName('Muster Formenbau');
    const erg = m.rebuild.berechneGolden(c.id, { jetzt: JETZT });
    expect(erg.felder).toBeGreaterThan(5);
    const nach = m.db.getDb().select().from(m.db.schema.companies).where(eq(m.db.schema.companies.id, c.id)).get()!;
    expect(nach).toMatchObject({ name: 'Muster Formenbau', rechtsform: 'GmbH & Co. KG', plz: '73525', ort: 'Schwäbisch Gmünd', bundesland: 'Baden-Württemberg' });
    const h = nach.herkunft as Record<string, { quelle: string; konfidenz: number; beobachtetAm: number; beobachtungId: number }>;
    // Herkunft pro Feld: Quelle, Konfidenz, Zeitpunkt und die Beobachtung, aus der der Wert stammt
    expect(h.name).toMatchObject({ quelle: 'offeneregister', wert: 'Muster Formenbau' });
    expect(h.plz.beobachtungId).toBeGreaterThan(0);
    expect(nach.goldenBerechnetAm).toBeTruthy();
  });

  it('ist idempotent und reproduzierbar (neu berechnen ergibt dasselbe)', () => {
    const c = firmaMitName('Probe Maschinenbau');
    m.rebuild.berechneGolden(c.id, { jetzt: JETZT });
    const eins = JSON.stringify(m.db.getDb().select().from(m.db.schema.companies).where(eq(m.db.schema.companies.id, c.id)).get());
    m.rebuild.berechneGolden(c.id, { jetzt: JETZT });
    expect(JSON.stringify(m.db.getDb().select().from(m.db.schema.companies).where(eq(m.db.schema.companies.id, c.id)).get())).toBe(eins);
  });

  it('die Webseite überstimmt den alten Registerseed bei der Adresse, ein neuer Registerstand überstimmt beide beim Namen', () => {
    const c = firmaMitName('Test Präzisionstechnik');
    obs(c.id, 'strasse', 'Neue Werkstraße 9', 'web');
    obs(c.id, 'plz', '01069', 'web');
    obs(c.id, 'name', 'Test Präzisionstechnik Dresden', 'handelsregister');
    m.rebuild.berechneGolden(c.id, { jetzt: JETZT });
    const nach = m.db.getDb().select().from(m.db.schema.companies).where(eq(m.db.schema.companies.id, c.id)).get()!;
    expect(nach).toMatchObject({ strasse: 'Neue Werkstraße 9', plz: '01069', name: 'Test Präzisionstechnik Dresden' });
    expect((nach.herkunft as Record<string, { quelle: string }>).name.quelle).toBe('handelsregister');
  });

  it('Mitarbeiterzahl immer mit Typ und Herkunft: Bundesanzeiger (exakt) schlägt die Schätzung der Webseite', () => {
    const c = firmaMitName('Demo Stanztechnik');
    obs(c.id, 'mitarbeiter', { zahl: 180 }, 'web', { typ: 'schaetzung', konfidenz: 0.5 });
    m.rebuild.berechneGolden(c.id, { jetzt: JETZT });
    let nach = m.db.getDb().select().from(m.db.schema.companies).where(eq(m.db.schema.companies.id, c.id)).get()!;
    expect(nach).toMatchObject({ mitarbeiterZahl: 180, mitarbeiterTyp: 'schaetzung', mitarbeiterKlasse: '100-249' });
    obs(c.id, 'mitarbeiter', { zahl: 230 }, 'bundesanzeiger', { typ: 'exakt', konfidenz: 0.95, beobachtetAm: new Date(JETZT - 400 * TAG) });
    m.rebuild.berechneGolden(c.id, { jetzt: JETZT });
    nach = m.db.getDb().select().from(m.db.schema.companies).where(eq(m.db.schema.companies.id, c.id)).get()!;
    expect(nach).toMatchObject({ mitarbeiterZahl: 230, mitarbeiterTyp: 'exakt' });
    expect((nach.herkunft as Record<string, { quelle: string; typ: string }>).mitarbeiter).toMatchObject({ quelle: 'bundesanzeiger', typ: 'exakt' });
  });

  it('nur eine Größenklasse (HGB) wird als Klasse ohne Zahl gespeichert', () => {
    const c = firmaMitName('Fiktiv Vorrichtungsbau');
    obs(c.id, 'mitarbeiter', { klasse: 'hgb_mittel' }, 'bundesanzeiger', { typ: 'klasse', konfidenz: 0.9 });
    m.rebuild.berechneGolden(c.id, { jetzt: JETZT });
    expect(firmaMitName('Fiktiv Vorrichtungsbau')).toMatchObject({ mitarbeiterZahl: null, mitarbeiterTyp: 'klasse', mitarbeiterKlasse: 'hgb_mittel' });
  });

  it('Branche: belegte Webseiten-Klassifikation (ab 0,6) vor WZ, sonst WZ', () => {
    const c = firmaMitName('Alpha Fräsmechanik');
    obs(c.id, 'branche_wz', { branche: 'sonstige_fertigung', wz: '25.62' }, 'offeneregister', { konfidenz: 0.7 });
    m.rebuild.berechneGolden(c.id, { jetzt: JETZT });
    expect(firmaMitName('Alpha Fräsmechanik')).toMatchObject({ branche: 'sonstige_fertigung' });
    obs(c.id, 'branche_web', { branche: 'werkzeugbau', konfidenz: 0.9, beleg: 'Wir bauen Werkzeuge' }, 'web', { konfidenz: 0.85 });
    m.rebuild.berechneGolden(c.id, { jetzt: JETZT });
    expect(firmaMitName('Alpha Fräsmechanik')).toMatchObject({ branche: 'werkzeugbau' });
    // Schwache Webseiten-Angabe (< 0,6) verdrängt die WZ nicht
    const d = firmaMitName('Beta Spritzguss & Werkzeugbau');
    obs(d.id, 'branche_wz', { branche: 'werkzeugbau', wz: '25.73' }, 'offeneregister', { konfidenz: 0.7 });
    obs(d.id, 'branche_web', { branche: 'formenbau', konfidenz: 0.5, beleg: 'x' }, 'web', { konfidenz: 0.5 });
    m.rebuild.berechneGolden(d.id, { jetzt: JETZT });
    expect(firmaMitName('Beta Spritzguss & Werkzeugbau').branche).toBe('werkzeugbau');
  });

  it('ein neuerer Extraktionslauf ersetzt die Beobachtungen des älteren', () => {
    const c = firmaMitName('Gamma Tool + Die Verwaltungs');
    obs(c.id, 'domain', 'alt.de', 'suche:brave', { run: 1 });
    obs(c.id, 'domain', 'neu.de', 'suche:brave', { run: 2 });
    m.rebuild.berechneGolden(c.id, { jetzt: JETZT });
    expect(firmaMitName('Gamma Tool + Die Verwaltungs').domain).toBe('neu.de');
  });

  it('Rolle je Person: Webseite (aktuell) vor dem alten Registerseed; Rolle wird der Taxonomie zugeordnet', () => {
    const c = firmaMitName('Muster Formenbau');
    const schmidt = m.db.getDb().select().from(m.db.schema.persons).all().find((p) => p.companyId === c.id && p.nachname === 'Schmidt-Meier')!;
    obs(schmidt.id, 'person', { vorname: 'Anna', nachname: 'Schmidt-Meier', rolle: 'sonstige', rolleOriginal: 'Leiterin Einkauf', url: 'https://x.de/team' }, 'web', { entityType: 'person', konfidenz: 0.75 });
    m.rebuild.berechneGolden(c.id, { jetzt: JETZT });
    const nach = m.db.getDb().select().from(m.db.schema.persons).all().find((p) => p.id === schmidt.id)!;
    // Webseite (aktuell) schlägt den Registerseed; „Leiterin Einkauf“ wird der Rolle der Taxonomie zugeordnet
    expect(nach).toMatchObject({ rolle: 'einkauf_leitung', rolleText: 'Leiterin Einkauf' });
    expect((nach.herkunft as { rolle: { quelle: string } }).rolle.quelle).toBe('web');
  });

  it('berechnet Scores mit Details und kann alle Firmen neu berechnen', () => {
    const n = m.rebuild.berechneAlleGolden({ jetzt: JETZT });
    expect(n).toBe(m.db.getDb().select().from(m.db.schema.companies).all().length);
    const s = m.db.getDb().select().from(m.db.schema.scores).all();
    expect(s).toHaveLength(n);
    const c = firmaMitName('Alpha Fräsmechanik');
    const score = s.find((x) => x.companyId === c.id)!;
    expect(score.datenScore).toBeGreaterThan(0);
    expect(score.icpScore).toBeGreaterThan(0);
    expect(score.details).toMatchObject({ daten: { fehlend: expect.any(Array) }, icp: { branche: expect.any(Number) } });
  });

  it('Kontaktdaten und Ansprechpartner fließen in den Datenscore ein', () => {
    const c = firmaMitName('Delta Maschinenfabrik');
    const vorher = m.rebuild.berechneGolden(c.id, { jetzt: JETZT }).datenScore.score;
    const person = m.db.getDb().select().from(m.db.schema.persons).all().find((p) => p.companyId === c.id)!;
    const cp = m.db.getDb().insert(m.db.schema.contactPoints).values({ companyId: c.id, personId: person.id, typ: 'email', wert: 'uwe.lange@delta.de', status: 'gueltig', konfidenz: 0.9, verifiziertAm: new Date(JETZT - TAG) }).returning({ id: m.db.schema.contactPoints.id }).get().id;
    m.db.getDb().insert(m.db.schema.kontaktErgebnisse).values({ companyId: c.id, rolleKey: 'geschaeftsfuehrung', status: 'gefunden', personId: person.id, contactPointId: cp, rollenTreffer: 'exakt', konfidenz: 0.9 }).run();
    const nachher = m.rebuild.berechneGolden(c.id, { jetzt: JETZT }).datenScore.score;
    expect(nachher).toBeGreaterThan(vorher);
  });

  it('Decay: der Registerseed von 2019 verliert bei der Personensuche gegenüber frischen Beobachtungen', async () => {
    const c = firmaMitName('Epsilon Werkzeugmaschinen');
    const person = m.db.getDb().select().from(m.db.schema.persons).all().find((p) => p.companyId === c.id)!;
    const tr = await new m.fin.WebsiteFinder().finde({
      firma: { id: c.id, name: c.name, nameNormalized: c.nameNormalized, ort: c.ort, domain: null },
      rolleKey: 'geschaeftsfuehrung',
      rollen: (await import('../contacts/rollen')).standardRollen,
      deps: {} as never,
      db: m.db.getDb(),
      jetzt: Date.now() + 8 * 365 * TAG,
    });
    const alt = tr.find((t) => t.nachname === person.nachname)!;
    expect(alt.konfidenz).toBeLessThan(0.7 * 0.5);
  });
});
