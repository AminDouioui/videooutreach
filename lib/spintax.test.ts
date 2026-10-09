import { describe, expect, it } from 'vitest';
import { hash32, loeseSpintax, pruefeKlammern } from './spintax';

describe('loeseSpintax', () => {
  it('ist deterministisch pro Seed und wählt eine Option', () => {
    const a = loeseSpintax('{Hallo|Guten Tag|Moin}', 'x:0:text');
    expect(loeseSpintax('{Hallo|Guten Tag|Moin}', 'x:0:text')).toBe(a);
    expect(['Hallo', 'Guten Tag', 'Moin']).toContain(a);
  });
  it('verteilt über verschiedene Seeds auf alle Optionen', () => {
    const treffer = new Set(Array.from({ length: 200 }, (_, i) => loeseSpintax('{a|b|c}', `lead-${i}:0:text`)));
    expect(treffer).toEqual(new Set(['a', 'b', 'c']));
  });
  it('löst Verschachtelung auf', () => {
    const erg = new Set(Array.from({ length: 100 }, (_, i) => loeseSpintax('{Hallo|Guten {Tag|Morgen}}!', `s${i}`)));
    expect(erg).toEqual(new Set(['Hallo!', 'Guten Tag!', 'Guten Morgen!']));
  });
  it('lässt {{Platzhalter}} und Fallbacks mit | unangetastet', () => {
    expect(loeseSpintax('Hi {{vorname|Hallo zusammen}} und {{firma}}', 's')).toBe('Hi {{vorname|Hallo zusammen}} und {{firma}}');
  });
  it('erlaubt Platzhalter innerhalb von Optionen', () => {
    const erg = new Set(Array.from({ length: 50 }, (_, i) => loeseSpintax('{Hallo {{vorname|du}}|Moin {{vorname}}}', `s${i}`)));
    expect(erg).toEqual(new Set(['Hallo {{vorname|du}}', 'Moin {{vorname}}']));
  });
  it('einzelne Klammern ohne | bleiben wörtlich', () => {
    expect(loeseSpintax('a {b} c { d } {', 's')).toBe('a {b} c { d } {');
    expect(loeseSpintax('{x {a|a} y}', 's')).toBe('{x a y}');
  });
  it('hash32 ist stabil', () => {
    expect(hash32('abc')).toBe(hash32('abc'));
    expect(hash32('abc')).not.toBe(hash32('abd'));
  });
});

describe('pruefeKlammern', () => {
  it('erkennt unbalancierte Klammern', () => {
    expect(pruefeKlammern('{a|b} {{x|y}} {c|{d|e}}')).toEqual([]);
    expect(pruefeKlammern('{a|b')).toHaveLength(1);
    expect(pruefeKlammern('a|b}')).toHaveLength(1);
    expect(pruefeKlammern('{{vorname')).toHaveLength(1);
  });
});
