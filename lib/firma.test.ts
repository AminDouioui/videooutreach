import { describe, expect, it } from 'vitest';
import { firmenDuplikate, firmenSchluessel } from './firma';

describe('Firmen-Duplikate', () => {
  it('vereinheitlicht Schreibweisen und Rechtsformen', () => {
    const k = firmenSchluessel('Müller GmbH');
    expect(firmenSchluessel('mueller gmbh')).toBe(k);
    expect(firmenSchluessel('Müller GmbH & Co. KG')).toBe(k);
    expect(firmenSchluessel('MÜLLER')).toBe(k);
    expect(firmenSchluessel('  Müller   GmbH ')).toBe(k);
  });
  it('lässt verschiedene Firmen verschieden', () => {
    expect(firmenSchluessel('Müller Bau GmbH')).not.toBe(firmenSchluessel('Müller GmbH'));
    expect(firmenSchluessel('AG Holding')).not.toBe(firmenSchluessel('Holding'));
  });
  it('behandelt „und“, „+“ und „&“ gleich', () => {
    expect(firmenSchluessel('Schmidt und Partner')).toBe(firmenSchluessel('Schmidt & Partner'));
    expect(firmenSchluessel('Schmidt + Partner mbH')).toBe(firmenSchluessel('Schmidt & Partner'));
  });
  it('markiert alle außer dem ersten Eintrag je Firma', () => {
    const d = firmenDuplikate([
      { id: 1, firma: 'Rittal GmbH & Co. KG' },
      { id: 2, firma: 'Bosch AG' },
      { id: 3, firma: 'rittal' },
      { id: 4, firma: 'Rittal GmbH' },
    ]);
    expect([...d].sort()).toEqual([3, 4]);
  });
});
