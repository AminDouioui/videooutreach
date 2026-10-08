import { describe, expect, it } from 'vitest';
import { begruessung, splitName } from './name';

describe('splitName', () => {
  it('Vorname + Nachname', () => expect(splitName('Max Mustermann')).toEqual({ vorname: 'Max', nachname: 'Mustermann' }));
  it('mehrere Vornamen', () => expect(splitName('  Hans Peter  Meier ')).toEqual({ vorname: 'Hans Peter', nachname: 'Meier' }));
  it('ein Wort → Nachname', () => expect(splitName('Meier')).toEqual({ vorname: '', nachname: 'Meier' }));
  it('leer', () => expect(splitName('  ')).toEqual({ vorname: '', nachname: '' }));
});

describe('begruessung', () => {
  it('mit Name', () => expect(begruessung({ vorname: 'Max', nachname: 'Mustermann' })).toBe('Guten Tag Max Mustermann'));
  it('nur Nachname', () => expect(begruessung({ vorname: '', nachname: 'Meier' })).toBe('Guten Tag Meier'));
  it('ohne Name', () => expect(begruessung({})).toBe('Guten Tag'));
});
