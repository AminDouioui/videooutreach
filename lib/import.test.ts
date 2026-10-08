import { describe, expect, it } from 'vitest';
import { applyMapping, guessMapping, summarize, validateRows, type Mapping, type Row } from './import';

const mapping: Mapping = guessMapping(['Name', 'Firma', 'Email']);
const leer = { existingEmails: new Set<string>(), suppressed: new Set<string>() };

describe('guessMapping', () => {
  it('erkennt Name, Firma, Email', () => {
    expect(mapping).toMatchObject({ name: 'Name', firma: 'Firma', email: 'Email', vorname: null, nachname: null });
  });
  it('ignoriert Groß-/Kleinschreibung, Leerzeichen und Bindestriche', () => {
    const m = guessMapping(['Ansprechpartner', 'FIRMEN NAME', 'E-Mail-Adresse', 'Web site']);
    expect(m.name).toBe('Ansprechpartner');
    expect(m.firma).toBe('FIRMEN NAME');
    expect(m.email).toBe('E-Mail-Adresse');
    expect(m.website).toBe('Web site');
  });
  it('unbekannte Spalten bleiben ungemappt', () => {
    expect(guessMapping(['Foo']).email).toBeNull();
  });
});

describe('applyMapping', () => {
  it('splittet vollen Namen, lowercase E-Mail, extra', () => {
    const m = guessMapping(['Name', 'Firma', 'Email', 'Ort']);
    const l = applyMapping({ Name: 'Max Mustermann', Firma: 'Musterbau GmbH', Email: ' Max@Example.DE ', Ort: 'Köln' }, m);
    expect(l).toMatchObject({ vorname: 'Max', nachname: 'Mustermann', email: 'max@example.de', firma: 'Musterbau GmbH' });
    expect(l.extra).toEqual({ Ort: 'Köln' });
  });
  it('nutzt vorname/nachname-Spalten statt Split', () => {
    const m = guessMapping(['Vorname', 'Nachname', 'Firma', 'Email']);
    const l = applyMapping({ Vorname: 'Anna', Nachname: 'Schmidt', Firma: 'X', Email: 'a@b.de' }, m);
    expect(l).toMatchObject({ vorname: 'Anna', nachname: 'Schmidt' });
  });
});

const zeile = (name: string, firma: string, email: string): Row => ({ Name: name, Firma: firma, Email: email });

describe('validateRows', () => {
  it('vergibt alle Status', () => {
    const rows = [
      zeile('A A', 'Eins GmbH', 'a@eins.de'),
      zeile('B B', 'Zwei AG', 'a@eins.de'), // Duplikat in Datei
      zeile('C C', 'Drei KG', 'kaputt'), // ungültig
      zeile('D D', '', 'd@vier.de'), // fehlende Firma
      zeile('E E', 'Fünf', ''), // fehlende E-Mail
      zeile('F F', 'Sechs', 'bestand@sechs.de'),
      zeile('G G', 'Sieben', 'gesperrt@sieben.de'),
      zeile('H H', 'Acht', 'h@acht.de'),
    ];
    const res = validateRows(rows, mapping, {
      existingEmails: new Set(['bestand@sechs.de']),
      suppressed: new Set(['gesperrt@sieben.de']),
    });
    expect(res.map((r) => r.status)).toEqual([
      'ok',
      'duplikat_datei',
      'ungueltige_email',
      'fehlende_pflichtfelder',
      'fehlende_pflichtfelder',
      'duplikat_bestand',
      'gesperrt',
      'ok',
    ]);
  });

  it('Duplikate sind case-insensitive', () => {
    const res = validateRows([zeile('A', 'X', 'A@x.de'), zeile('B', 'Y', 'a@X.de')], mapping, leer);
    expect(res.map((r) => r.status)).toEqual(['ok', 'duplikat_datei']);
  });

  it('Zusammenfassung', () => {
    const rows: Row[] = [
      ...Array.from({ length: 8 }, (_, i) => zeile('N N', `F${i}`, `u${i}@x.de`)),
      zeile('N N', 'Dup', 'u0@x.de'),
      zeile('N N', 'Bad', 'bad'),
    ];
    expect(summarize(validateRows(rows, mapping, leer))).toBe('8 gültig, 1 Duplikat, 1 ungültige E-Mail');
  });
});
