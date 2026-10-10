import { describe, expect, it } from 'vitest';
import { istGueltigeZeitzone } from './time';
import { bestimmeZeitzone, GAENGIGE_ZEITZONEN, zeitzoneAusLand, zeitzoneAusTld } from './zeitzone';

describe('zeitzoneAusTld', () => {
  it.each([
    ['max@firma.at', 'firma.at', 'Europe/Vienna'],
    ['x', 'www.firma.ch', 'Europe/Zurich'],
    ['x', 'firma.co.uk', 'Europe/London'],
    ['x', 'firma.uk', 'Europe/London'],
    ['x', 'firma.fr', 'Europe/Paris'],
    ['x', 'firma.nl', 'Europe/Amsterdam'],
    ['x', 'firma.it', 'Europe/Rome'],
    ['x', 'firma.es', 'Europe/Madrid'],
    ['x', 'firma.pl', 'Europe/Warsaw'],
    ['x', 'firma.us', 'America/New_York'],
  ])('%s %s → %s', (_x, host, zone) => expect(zeitzoneAusTld(host)).toBe(zone));

  it('generische TLDs liefern keine Schätzung', () => {
    for (const h of ['firma.com', 'firma.de', 'firma.net', 'firma.org', 'firma.io', 'firma.eu', 'localhost', '', undefined, null]) expect(zeitzoneAusTld(h)).toBeNull();
  });
  it('versteht URLs mit Schema, Pfad, Port und Großschreibung', () => {
    expect(zeitzoneAusTld('HTTPS://www.Firma.AT/kontakt?x=1')).toBe('Europe/Vienna');
    expect(zeitzoneAusTld('http://firma.ch:8080/')).toBe('Europe/Zurich');
    expect(zeitzoneAusTld('firma.fr.')).toBe('Europe/Paris');
  });
});

describe('zeitzoneAusLand', () => {
  it('ISO-Codes (auch UK und Großschreibung)', () => {
    expect(zeitzoneAusLand('de')).toBe('Europe/Berlin');
    expect(zeitzoneAusLand('AT')).toBe('Europe/Vienna');
    expect(zeitzoneAusLand('ch')).toBe('Europe/Zurich');
    expect(zeitzoneAusLand('us')).toBe('America/New_York');
    expect(zeitzoneAusLand('uk')).toBe('Europe/London');
    expect(zeitzoneAusLand('GB')).toBe('Europe/London');
    expect(zeitzoneAusLand('fr')).toBe('Europe/Paris');
  });
  it('deutsche und englische Namen', () => {
    expect(zeitzoneAusLand('Österreich')).toBe('Europe/Vienna');
    expect(zeitzoneAusLand('Schweiz')).toBe('Europe/Zurich');
    expect(zeitzoneAusLand('United Kingdom')).toBe('Europe/London');
    expect(zeitzoneAusLand('Vereinigtes Königreich')).toBe('Europe/London');
    expect(zeitzoneAusLand('USA')).toBe('America/New_York');
    expect(zeitzoneAusLand(' Niederlande ')).toBe('Europe/Amsterdam');
    expect(zeitzoneAusLand('Spain')).toBe('Europe/Madrid');
  });
  it('unbekannt oder leer = null', () => {
    expect(zeitzoneAusLand('Atlantis')).toBeNull();
    expect(zeitzoneAusLand('xx')).toBeNull();
    expect(zeitzoneAusLand('')).toBeNull();
    expect(zeitzoneAusLand(undefined)).toBeNull();
  });
});

describe('bestimmeZeitzone', () => {
  it('Reihenfolge Spalte → Land → Website → E-Mail', () => {
    expect(bestimmeZeitzone({ zeitzone: 'europe/london', land: 'fr', website: 'a.at', email: 'x@a.ch' })).toEqual({ zeitzone: 'Europe/London', quelle: 'angabe' });
    expect(bestimmeZeitzone({ land: 'fr', website: 'a.at', email: 'x@a.ch' })).toEqual({ zeitzone: 'Europe/Paris', quelle: 'land' });
    expect(bestimmeZeitzone({ website: 'https://a.at', email: 'x@a.ch' })).toEqual({ zeitzone: 'Europe/Vienna', quelle: 'website_tld' });
    expect(bestimmeZeitzone({ website: 'a.com', email: 'x@a.ch' })).toEqual({ zeitzone: 'Europe/Zurich', quelle: 'email_tld' });
    expect(bestimmeZeitzone({ website: 'a.com', email: 'x@a.de' })).toEqual({ zeitzone: null, quelle: null });
  });
  it('ungültige Zeitzone: Hinweis und Weiterschätzen', () => {
    expect(bestimmeZeitzone({ zeitzone: 'Mars/X', email: 'x@a.nl' })).toEqual({ zeitzone: 'Europe/Amsterdam', quelle: 'email_tld', ungueltig: 'Mars/X' });
    expect(bestimmeZeitzone({ zeitzone: 'Mars/X', email: 'x@a.com' })).toEqual({ zeitzone: null, quelle: null, ungueltig: 'Mars/X' });
  });
  it('alle eingebauten Zonen sind gültig', () => {
    for (const z of GAENGIGE_ZEITZONEN) expect(istGueltigeZeitzone(z), z).toBe(true);
    for (const land of ['de', 'at', 'ch', 'li', 'gb', 'ie', 'fr', 'nl', 'be', 'lu', 'it', 'es', 'pt', 'pl', 'cz', 'sk', 'hu', 'si', 'hr', 'dk', 'se', 'no', 'fi', 'ee', 'lv', 'lt', 'ro', 'bg', 'gr', 'tr', 'ua', 'us', 'ca', 'mx', 'br', 'ar', 'cl', 'co', 'au', 'nz', 'jp', 'cn', 'hk', 'sg', 'in', 'ae', 'il', 'za', 'ru'])
      expect(istGueltigeZeitzone(zeitzoneAusLand(land)), land).toBe(true);
  });
});
