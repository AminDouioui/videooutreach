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

describe('Nur ein Kontakt pro Firma', () => {
  it('markiert weitere Kontakte derselben Firma, auch mit anderer Rechtsform', () => {
    const rows = [zeile('A', 'Müller GmbH', 'a@m.de'), zeile('B', 'Bosch AG', 'b@b.de'), zeile('C', 'mueller gmbh & co. kg', 'c@m.de')];
    expect(validateRows(rows, mapping, leer).map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
    expect(validateRows(rows, mapping, { ...leer, einProFirma: true }).map((r) => r.status)).toEqual(['ok', 'ok', 'duplikat_firma']);
  });
  it('gleicht mit Firmen ab, die schon in der Kampagne sind', () => {
    const res = validateRows([zeile('A', 'Bosch', 'a@b.de')], mapping, { ...leer, einProFirma: true, existingFirmen: new Set(['bosch']) });
    expect(res[0].status).toBe('duplikat_firma');
    expect(summarize(res)).toBe('0 gültig, 1 weiterer Kontakt derselben Firma');
  });
});

describe('Domain-Sperre und MX im Import', () => {
  const mapping = { ...guessMapping(['Firma', 'E-Mail']) };
  const rows = [
    { Firma: 'A', 'E-Mail': 'a@gesperrt.de' },
    { Firma: 'B', 'E-Mail': 'b@sub.gesperrt.de' },
    { Firma: 'C', 'E-Mail': 'c@tot.de' },
    { Firma: 'D', 'E-Mail': 'd@unklar.de' },
  ];
  const ctx = {
    existingEmails: new Set<string>(),
    suppressed: new Set(['@gesperrt.de']),
    mx: new Map<string, 'ok' | 'kein_mx' | 'unbekannt'>([['tot.de', 'kein_mx'], ['unklar.de', 'unbekannt']]),
  };

  it('Domain-Eintrag sperrt alle Adressen der Domain (nicht Subdomains)', () => {
    expect(validateRows(rows, mapping, ctx).map((r) => r.status)).toEqual(['gesperrt', 'ok', 'kein_mx', 'ok']);
  });

  it('kein_mx wird standardmäßig nicht importiert, mit mxTrotzdem als Warnung', () => {
    const standard = validateRows(rows, mapping, ctx);
    expect(standard[2]).toMatchObject({ status: 'kein_mx', warnung: 'Domain nimmt keine Mails an' });
    const trotzdem = validateRows(rows, mapping, { ...ctx, mxTrotzdem: true });
    expect(trotzdem[2]).toMatchObject({ status: 'ok', warnung: 'Domain nimmt keine Mails an' });
    expect(trotzdem[3].warnung).toBeUndefined();
  });

  it('kein_mx verbraucht bei „ein Kontakt pro Firma“ keinen Firmenplatz', () => {
    const r = validateRows(
      [
        { Firma: 'Müller GmbH', 'E-Mail': 'a@tot.de' },
        { Firma: 'Müller GmbH', 'E-Mail': 'b@mueller.de' },
      ],
      mapping,
      { ...ctx, einProFirma: true },
    );
    expect(r.map((x) => x.status)).toEqual(['kein_mx', 'ok']);
  });

  it('Zusammenfassung nennt Domains ohne Mail-Server', () => {
    expect(summarize(validateRows(rows, mapping, ctx))).toContain('1 mit Domain ohne Mail-Server');
  });
});
