import { describe, expect, it } from 'vitest';
import { bildeKandidaten, istGenerischesPostfach, leiteMusterAb, musterKonfidenzen, zaehleBelege, zerlegeAdresse } from './muster';
import { falteVarianten, namensVarianten } from './namen';
import { Rollenverzeichnis, standardRollen } from './rollen';

describe('Namensvarianten', () => {
  it('faltet Umlaute und ß in zwei Schreibweisen', () => {
    expect(falteVarianten('Müller')).toEqual(['mueller', 'muller']);
    expect(falteVarianten('Weiß')).toEqual(['weiss', 'weis']);
    expect(falteVarianten('Schmidt')).toEqual(['schmidt']);
    expect(falteVarianten("O'Neil")).toEqual(['oneil']);
    expect(falteVarianten('José')).toEqual(['jose']);
  });
  it('bildet Varianten für Doppelnamen, Bindestrich-Namen und Zusätze', () => {
    expect(namensVarianten({ vorname: 'Hans-Peter', nachname: 'Schmidt-Meier' })).toEqual({
      vornamen: ['hans', 'hanspeter', 'hans-peter'],
      nachnamen: ['schmidt-meier', 'schmidtmeier', 'schmidt', 'meier'],
      initialen: ['h', 'hp'],
    });
    const heide = namensVarianten({ vorname: 'Klaus', nachname: 'von der Heide' });
    expect(heide.nachnamen).toEqual(['heide', 'vonderheide']);
    expect(namensVarianten({ vorname: null, nachname: 'Müller' })).toMatchObject({ vornamen: [], nachnamen: ['mueller', 'muller'], initialen: [] });
  });
});

describe('Muster ableiten (Schritt B)', () => {
  const hans = { vorname: 'Hans', nachname: 'Müller' };
  it.each([
    ['hans.mueller@firma.de', 'vorname.nachname'],
    ['h.mueller@firma.de', 'v.nachname'],
    ['hmueller@firma.de', 'vnachname'],
    ['hansmueller@firma.de', 'vornamenachname'],
    ['mueller@firma.de', 'nachname'],
    ['hans@firma.de', 'vorname'],
    ['hans_mueller@firma.de', 'vorname_nachname'],
    ['hans-mueller@firma.de', 'vorname-nachname'],
    ['mueller.hans@firma.de', 'nachname.vorname'],
    ['mueller_hans@firma.de', 'nachname_vorname'],
    ['muellerh@firma.de', 'nachnamev'],
    ['mueller.h@firma.de', 'nachname.v'],
    ['Hans.Mueller@Firma.de', 'vorname.nachname'],
    ['hans.mueller+vertrieb@firma.de', 'vorname.nachname'],
  ])('%s → %s', (adresse, muster) => {
    expect(leiteMusterAb(adresse, hans)).toContain(muster);
  });
  it('erkennt auch die vereinfachte Umlaut-Schreibweise (ü → u)', () => {
    expect(leiteMusterAb('hans.muller@firma.de', hans)).toEqual(['vorname.nachname']);
  });
  it('ignoriert generische Postfächer und fremde Namen', () => {
    expect(leiteMusterAb('info@firma.de', { vorname: 'Info', nachname: 'Team' })).toEqual([]);
    expect(leiteMusterAb('peter.schulz@firma.de', hans)).toEqual([]);
    expect(leiteMusterAb('kein-mail', hans)).toEqual([]);
  });
  it('liest Doppelnamen in allen üblichen Schreibweisen', () => {
    const p = { vorname: 'Anna', nachname: 'Schmidt-Meier' };
    expect(leiteMusterAb('anna.schmidt-meier@firma.de', p)).toContain('vorname.nachname');
    expect(leiteMusterAb('anna.schmidtmeier@firma.de', p)).toContain('vorname.nachname');
    expect(leiteMusterAb('a.meier@firma.de', p)).toContain('v.nachname');
  });
  it('zerlegt Adressen', () => {
    expect(zerlegeAdresse('A.B@Firma.DE')).toEqual({ local: 'a.b', domain: 'firma.de' });
    expect(zerlegeAdresse('kaputt')).toBeNull();
    expect(istGenerischesPostfach('Info')).toBe(true);
    expect(istGenerischesPostfach('hans.mueller')).toBe(false);
  });
});

describe('Muster-Konfidenz', () => {
  it('ohne Belege gilt der Standard-Prior (vorname.nachname zuerst)', () => {
    const k = musterKonfidenzen(new Map());
    expect(k[0].muster).toBe('vorname.nachname');
    expect(k[0].konfidenz).toBeCloseTo(0.38 / 0.96, 2);
    expect(k.reduce((s, m) => s + m.konfidenz, 0)).toBeCloseTo(1, 5);
  });
  it('das häufigste belegte Muster wird primär, Konfidenz wächst mit der Zahl der Belege', () => {
    const eins = musterKonfidenzen(new Map([['v.nachname', 1]]));
    const drei = musterKonfidenzen(new Map([['v.nachname', 3]]));
    expect(eins[0].muster).toBe('v.nachname');
    expect(drei[0].konfidenz).toBeGreaterThan(eins[0].konfidenz);
    expect(drei[0].konfidenz).toBeGreaterThan(0.75);
    // Gegenbelege senken die Konfidenz
    const gemischt = musterKonfidenzen(new Map([['v.nachname', 3], ['vorname.nachname', 2]]));
    expect(gemischt[0].muster).toBe('v.nachname');
    expect(gemischt[0].konfidenz).toBeLessThan(drei[0].konfidenz);
  });
  it('zählt Belege je Adresse einmal und mit Namen', () => {
    const b = zaehleBelege([
      { adresse: 'h.mueller@firma.de', person: { vorname: 'Hans', nachname: 'Müller' } },
      { adresse: 'H.Mueller@firma.de', person: { vorname: 'Hans', nachname: 'Müller' } },
      { adresse: 'a.schmidt@firma.de', person: { vorname: 'Anna', nachname: 'Schmidt' } },
      { adresse: 'info@firma.de', person: { vorname: 'X', nachname: 'Y' } },
    ]);
    expect(b.get('v.nachname')).toBe(2);
  });
});

describe('Kandidaten bilden (Schritt C)', () => {
  it('setzt den Namen in alle Muster ein, sortiert nach Muster-Konfidenz', () => {
    const k = bildeKandidaten({ vorname: 'Hans', nachname: 'Müller' }, 'firma.de', musterKonfidenzen(new Map()));
    expect(k[0]).toMatchObject({ adresse: 'hans.mueller@firma.de', muster: 'vorname.nachname' });
    const adressen = k.map((x) => x.adresse);
    expect(adressen).toEqual(expect.arrayContaining(['h.mueller@firma.de', 'hmueller@firma.de', 'hans.muller@firma.de', 'mueller@firma.de']));
    // Konfidenz fällt: erste Umlaut-Variante vor der zweiten
    expect(adressen.indexOf('hans.mueller@firma.de')).toBeLessThan(adressen.indexOf('hans.muller@firma.de'));
    expect(new Set(adressen).size).toBe(adressen.length);
  });
  it('belegtes Muster steht vorn', () => {
    const k = bildeKandidaten({ vorname: 'Anna', nachname: 'Roth' }, 'Firma.de', musterKonfidenzen(new Map([['v.nachname', 3]])));
    expect(k[0].adresse).toBe('a.roth@firma.de');
  });
  it('bildet Varianten für Doppelnamen und Zusätze', () => {
    const adressen = bildeKandidaten({ vorname: 'Klaus', nachname: 'von der Heide' }, 'firma.de', musterKonfidenzen(new Map())).map((x) => x.adresse);
    expect(adressen).toEqual(expect.arrayContaining(['klaus.heide@firma.de', 'klaus.vonderheide@firma.de']));
  });
  it('ohne Vorname nur Muster, die keinen brauchen', () => {
    const adressen = bildeKandidaten({ vorname: null, nachname: 'Roth' }, 'firma.de', musterKonfidenzen(new Map())).map((x) => x.adresse);
    expect(adressen).toEqual(['roth@firma.de']);
  });
  it('begrenzt die Zahl der Kandidaten', () => {
    expect(bildeKandidaten({ vorname: 'Hans-Peter', nachname: 'Schmidt-Müller' }, 'firma.de', musterKonfidenzen(new Map()), 10)).toHaveLength(10);
  });
});

describe('Rollen-Matching', () => {
  it.each([
    ['Einkaufsleiter', 'exakt'],
    ['Leiter Einkauf', 'exakt'],
    ['Leiterin Einkauf', 'exakt'],
    ['Head of Procurement', 'exakt'],
    ['Purchasing Manager', 'exakt'],
    ['Leiter Beschaffung (m/w/d)', 'exakt'],
    ['Strategischer Einkaufsleiter', 'synonym'],
    ['Geschäftsführer', 'fallback'],
    ['Geschäftsführerin', 'fallback'],
    ['Managing Director', 'fallback'],
    ['Leiter Fertigung', 'keiner'],
    ['Sachbearbeiter Buchhaltung', 'keiner'],
    ['', 'keiner'],
  ])('%s für Einkaufsleiter: %s', (text, erwartet) => {
    expect(standardRollen.vergleiche('einkauf_leitung', text).treffer).toBe(erwartet);
  });
  it('Fallback hat niedrigeren Faktor als ein exakter Treffer', () => {
    expect(standardRollen.vergleiche('einkauf_leitung', 'Geschäftsführer').faktor).toBeLessThan(standardRollen.vergleiche('einkauf_leitung', 'Einkaufsleiter').faktor);
  });
  it('ist konfigurierbar (eigene Rolle, eigene Synonyme)', () => {
    const v = new Rollenverzeichnis([{ key: 'qs', label: 'QS-Leiter', synonyme: ['Leiter Qualitätssicherung', 'Head of Quality'], fallbacks: [] }]);
    expect(v.vergleiche('qs', 'Head of Quality').treffer).toBe('exakt');
    expect(v.vergleiche('qs', 'Einkaufsleiter').treffer).toBe('keiner');
  });
  it('„Technischer Geschäftsführer“ ist eine eigene Rolle und kein Einkaufs-Fallback', () => {
    expect(standardRollen.klassifiziere('Technischer Geschäftsführer')?.key).toBe('technik_leitung');
  });
});
