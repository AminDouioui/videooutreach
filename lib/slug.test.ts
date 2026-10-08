import { describe, expect, it } from 'vitest';
import { createSlug, slugBase } from './slug';

describe('slugBase', () => {
  it('entfernt Rechtsform', () => expect(slugBase('Musterbau GmbH')).toBe('musterbau'));
  it('Umlaute und GmbH & Co. KG', () => expect(slugBase('Müller & Söhne GmbH & Co. KG')).toBe('mueller-soehne'));
  it('ß und AG', () => expect(slugBase('Straßenbau AG')).toBe('strassenbau'));
  it('UG (haftungsbeschränkt)', () => expect(slugBase('Krümel UG (haftungsbeschränkt)')).toBe('kruemel'));
  it('Diakritika', () => expect(slugBase('Café Élan e.K.')).toBe('cafe-elan'));
  it('kürzt auf 30 Zeichen ohne Bindestrich am Ende', () => {
    const s = slugBase('Ein sehr langer Firmenname der abgeschnitten werden muss GmbH');
    expect(s.length).toBeLessThanOrEqual(30);
    expect(s.endsWith('-')).toBe(false);
  });
  it('leer → video', () => expect(slugBase('GmbH')).toBe('video'));
  it('Teilwörter bleiben erhalten', () => expect(slugBase('Agrar Kgaard')).toBe('agrar-kgaard'));
});

describe('createSlug', () => {
  it('hängt 4 Zeichen an', () => expect(createSlug('Musterbau GmbH', () => false)).toMatch(/^musterbau-[a-z0-9]{4}$/));
  it('wiederholt bei Kollision', () => {
    let n = 0;
    const slug = createSlug('Musterbau GmbH', () => ++n < 3);
    expect(n).toBe(3);
    expect(slug).toMatch(/^musterbau-/);
  });
});
