import { describe, expect, it } from 'vitest';
import { bundeslandVonPlz, normalisiereBundesland, normalisiereStrasse, parseAdresse } from './normalize/adresse';
import { trenneFirma } from './normalize/firma';
import { normalisiereRolle, parsePerson } from './normalize/person';
import { parseRegister, registerSchluessel } from './normalize/register';
import { normalisiereTelefon } from './normalize/telefon';

describe('Firmenname und Rechtsform', () => {
  it.each([
    ['Müller Werkzeugbau GmbH', 'Müller Werkzeugbau', 'GmbH'],
    ['Muster Formenbau GmbH & Co. KG', 'Muster Formenbau', 'GmbH & Co. KG'],
    ['Muster Formenbau GmbH u. Co KG', 'Muster Formenbau', 'GmbH & Co. KG'],
    ['Muster Formenbau GmbH + Co. KG', 'Muster Formenbau', 'GmbH & Co. KG'],
    ['Probe Maschinenbau AG', 'Probe Maschinenbau', 'AG'],
    ['Test Präzisionstechnik UG (haftungsbeschränkt)', 'Test Präzisionstechnik', 'UG (haftungsbeschränkt)'],
    ['Demo Stanztechnik e.K.', 'Demo Stanztechnik', 'e.K.'],
    ['Alpha Fräsmechanik, GmbH', 'Alpha Fräsmechanik', 'GmbH'],
    ['Schmidt gGmbH', 'Schmidt', 'gGmbH'],
    ['Hamburg Werkzeug', 'Hamburg Werkzeug', null],
    ['Maschinenfabrik Wagner mbH', 'Maschinenfabrik Wagner', 'mbH'],
  ])('%s', (roh, name, form) => {
    const f = trenneFirma(roh);
    expect(f.name).toBe(name);
    expect(f.rechtsform).toBe(form);
  });

  it('bildet einen Matching-Schlüssel ohne Umlaute und Rechtsform', () => {
    expect(trenneFirma('Müller Präzisions GmbH & Co. KG').nameNormalized).toBe(trenneFirma('MUELLER PRAEZISIONS GmbH').nameNormalized);
  });

  it('trennt nichts ab, wenn der Name nur aus der Rechtsform besteht', () => {
    expect(trenneFirma('AG')).toMatchObject({ name: 'AG', rechtsform: null });
  });

  it('vereinheitlicht Leerraum und typografische Anführungszeichen', () => {
    expect(trenneFirma('  „Alpha“   Technik   GmbH ').name).toBe('"Alpha" Technik');
  });
});

describe('Adresse', () => {
  it('zerlegt Straße, PLZ und Ort', () => {
    expect(parseAdresse('Industriestraße 4, 70469 Stuttgart')).toEqual({ strasse: 'Industriestraße 4', plz: '70469', ort: 'Stuttgart', bundesland: 'Baden-Württemberg', bundeslandHerkunft: 'plz' });
  });
  it('liest mehrzeilige Adressen mit Land', () => {
    expect(parseAdresse('Hauptstr. 12\n73525 Schwäbisch Gmünd\nDeutschland')).toMatchObject({ strasse: 'Hauptstraße 12', plz: '73525', ort: 'Schwäbisch Gmünd' });
  });
  it('bevorzugt das Bundesland der Quelle vor der PLZ-Ableitung', () => {
    const a = parseAdresse('Am Werk 3, 01067 Dresden', 'Sachsen');
    expect(a).toMatchObject({ bundesland: 'Sachsen', bundeslandHerkunft: 'quelle' });
  });
  it('ordnet mehrdeutige PLZ-Bereiche nicht zu', () => {
    expect(bundeslandVonPlz('88400')).toBeNull();
    expect(bundeslandVonPlz('21335')).toBeNull();
    expect(bundeslandVonPlz('73525')).toBe('Baden-Württemberg');
    expect(bundeslandVonPlz('abcde')).toBeNull();
  });
  it('liefert bei fehlender PLZ nur die Straße', () => {
    expect(parseAdresse('Musterweg 3')).toMatchObject({ strasse: 'Musterweg 3', plz: null, ort: null, bundesland: null });
  });
  it('gibt null für leere Eingaben', () => {
    expect(parseAdresse('  ')).toBeNull();
    expect(parseAdresse(null)).toBeNull();
  });
  it('vereinheitlicht Straßenschreibweisen und Bundesländer', () => {
    expect(normalisiereStrasse('Blaubeurer Strasse 20')).toBe('Blaubeurer Straße 20');
    expect(normalisiereStrasse('Hauptstr.5')).toBe('Hauptstraße5');
    expect(normalisiereBundesland('Baden-Wuerttemberg')).toBe('Baden-Württemberg');
    expect(normalisiereBundesland('NRW')).toBe('Nordrhein-Westfalen');
    expect(normalisiereBundesland('Atlantis')).toBeNull();
  });
});

describe('Telefon', () => {
  it('normalisiert Festnetz nach E.164', () => {
    expect(normalisiereTelefon('0711 1234567')).toMatchObject({ e164: '+49711123456' + '7', typ: 'festnetz' });
    expect(normalisiereTelefon('+49 (0) 711 123 45-67')?.e164).toBe('+497111234567');
  });
  it('erkennt Mobilnummern', () => {
    expect(normalisiereTelefon('0171 2345678')).toMatchObject({ e164: '+491712345678', typ: 'mobil' });
    expect(normalisiereTelefon('Mobil: +49 151 23456789')?.typ).toBe('mobil');
  });
  it('verwirft ungültige Nummern', () => {
    expect(normalisiereTelefon('12345')).toBeNull();
    expect(normalisiereTelefon('abc')).toBeNull();
  });
  it('markiert Sonderrufnummern als sonstige', () => {
    expect(normalisiereTelefon('0800 1234567')?.typ).toBe('sonstige');
  });
});

describe('Person und Rolle', () => {
  it('liest „Nachname, Vorname“ aus dem Register', () => {
    expect(parsePerson('Müller, Hans', 'Geschäftsführer')).toEqual({ vorname: 'Hans', nachname: 'Müller', titel: [], rolle: 'geschaeftsfuehrer', rolleOriginal: 'Geschäftsführer' });
  });
  it('trennt Titel ab', () => {
    expect(parsePerson('Prof. Dr.-Ing. Anna Schmidt-Meier')).toMatchObject({ vorname: 'Anna', nachname: 'Schmidt-Meier', titel: ['Prof.', 'Dr.-Ing.'] });
    expect(parsePerson('Dipl.-Ing. (FH) Peter Weiß')).toMatchObject({ vorname: 'Peter', nachname: 'Weiß', titel: ['Dipl.-Ing.', '(FH)'] });
  });
  it('behält Namenszusätze beim Nachnamen', () => {
    expect(parsePerson('Klaus von der Heide')).toMatchObject({ vorname: 'Klaus', nachname: 'von der Heide' });
    expect(parsePerson('Heide, Klaus von der')).toMatchObject({ vorname: 'Klaus von der', nachname: 'Heide' });
  });
  it('behält Doppelvornamen', () => {
    expect(parsePerson('Hans-Peter Müller')).toMatchObject({ vorname: 'Hans-Peter', nachname: 'Müller' });
    expect(parsePerson('Anna Maria Roth')).toMatchObject({ vorname: 'Anna Maria', nachname: 'Roth' });
  });
  it('behandelt ein einzelnes Wort als Nachnamen und leere Namen als null', () => {
    expect(parsePerson('Müller')).toMatchObject({ vorname: null, nachname: 'Müller' });
    expect(parsePerson('  ')).toBeNull();
    expect(parsePerson('Dr.')).toBeNull();
  });
  it.each([
    ['Geschäftsführer', 'geschaeftsfuehrer'],
    ['Geschaeftsfuehrender Gesellschafter', 'geschaeftsfuehrer'],
    ['Managing Director', 'geschaeftsfuehrer'],
    ['Vorstand', 'vorstand'],
    ['Prokurist', 'prokurist'],
    ['Inhaber', 'inhaber'],
    ['Persönlich haftender Gesellschafter', 'gesellschafter'],
    ['Aufsichtsrat', 'sonstige'],
    [null, 'sonstige'],
  ])('Rolle %s', (roh, rolle) => {
    expect(normalisiereRolle(roh)).toBe(rolle);
  });
});

describe('Register', () => {
  it('liest Gericht, Art und Nummer', () => {
    expect(parseRegister('Amtsgericht Stuttgart HRB 12345')).toEqual({ art: 'HRB', nummer: '12345', gericht: 'Stuttgart' });
    expect(parseRegister('Stuttgart HRA 99')).toEqual({ art: 'HRA', nummer: '99', gericht: 'Stuttgart' });
    expect(parseRegister('Amtsgericht Berlin (Charlottenburg) HRB 12345 B')).toMatchObject({ art: 'HRB', nummer: '12345' });
  });
  it('rät nichts bei fehlenden Angaben', () => {
    expect(parseRegister('HRB 12345')).toEqual({ art: 'HRB', nummer: '12345', gericht: null });
    expect(parseRegister('keine Angabe')).toEqual({ art: null, nummer: null, gericht: null });
    expect(parseRegister(null)).toEqual({ art: null, nummer: null, gericht: null });
  });
  it('bildet den harten Match-Schlüssel nur bei vollständigen Angaben', () => {
    expect(registerSchluessel(parseRegister('Amtsgericht Düsseldorf HRB 7'))).toBe('duesseldorf|HRB|7');
    expect(registerSchluessel(parseRegister('HRB 7'))).toBeNull();
  });
});
