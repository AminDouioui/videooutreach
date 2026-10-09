import { describe, expect, it } from 'vitest';
import { extraVariablen, normalisiereSpaltenname, pruefeVorlage, STANDARD_VARIABLEN, verwendeteVariablen } from './vorlage';

describe('normalisiereSpaltenname', () => {
  it('klein, Umlaute aufgelöst, Sonderzeichen → _', () => {
    expect(normalisiereSpaltenname('Größe (m²)')).toBe('groesse_m2');
    expect(normalisiereSpaltenname('  Stadt / PLZ ')).toBe('stadt_plz');
    expect(normalisiereSpaltenname('Ärger-Straße')).toBe('aerger_strasse');
    expect(normalisiereSpaltenname('???')).toBe('');
  });
  it('extraVariablen: erste Spalte gewinnt bei Kollision', () => {
    expect(extraVariablen({ 'Stadt ': 'Köln', stadt: 'Bonn', Ort: ' Rhein ' })).toEqual({ stadt: 'Köln', ort: 'Rhein' });
    expect(extraVariablen(null)).toEqual({});
  });
});

describe('pruefeVorlage', () => {
  it('meldet unbekannte Platzhalter als Warnung, Klammern als Fehler', () => {
    const p = pruefeVorlage('{{firma}} {{stadt|dort}} {{foo}} {a|b', [...STANDARD_VARIABLEN, 'stadt']);
    expect(p.unbekannt).toEqual(['foo']);
    expect(p.fehler).toHaveLength(1);
  });
  it('verwendeteVariablen', () => {
    expect(verwendeteVariablen('{{ A }} {{b|x}} {{a}}')).toEqual(['a', 'b']);
  });
});
