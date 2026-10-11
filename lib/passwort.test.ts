import { describe, expect, it } from 'vitest';
import { hashePasswort, MIN_PASSWORT_LAENGE, passwortProblem, pruefeDummyPasswort, pruefePasswort } from './passwort';

// Nur Test-Passwörter, keine echten
describe('Passwort-Hashing (scrypt)', () => {
  it('Format salz:hash (hex), je Hash ein anderes Salz', async () => {
    const a = await hashePasswort('test-passwort-eins');
    const b = await hashePasswort('test-passwort-eins');
    expect(a).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(a).not.toBe(b);
    expect(a.split(':')[0]).not.toBe(b.split(':')[0]);
  });
  it('richtiges Passwort passt, falsches nicht', async () => {
    const h = await hashePasswort('test-passwort-eins');
    expect(await pruefePasswort('test-passwort-eins', h)).toBe(true);
    expect(await pruefePasswort('test-passwort-zwei', h)).toBe(false);
    expect(await pruefePasswort('', h)).toBe(false);
    expect(await pruefePasswort('Test-Passwort-eins', h)).toBe(false);
  });
  it('Unicode wird normalisiert (NFKC), Umlaute funktionieren', async () => {
    const h = await hashePasswort('Grüße-aus-Köln-123');
    expect(await pruefePasswort('Grüße-aus-Köln-123', h)).toBe(true);
  });
  it('kaputte gespeicherte Werte gelten als falsch (kein Fehler)', async () => {
    for (const kaputt of ['', 'abc', 'zz:zz', 'a:b:c', `${'0'.repeat(32)}:${'0'.repeat(10)}`, 'x'.repeat(500)]) {
      expect(await pruefePasswort('irgendwas-langes-123', kaputt)).toBe(false);
    }
  });
  it('Dummy-Prüfung liefert immer false', async () => {
    expect(await pruefeDummyPasswort('irgendwas-langes-123')).toBe(false);
  });
  it('Passwortrichtlinie: mindestens 12 Zeichen', () => {
    expect(MIN_PASSWORT_LAENGE).toBe(12);
    expect(passwortProblem('kurz')).toMatch(/mindestens 12/);
    expect(passwortProblem('a'.repeat(11))).not.toBeNull();
    expect(passwortProblem('a'.repeat(12))).toBeNull();
    expect(passwortProblem('a'.repeat(201))).not.toBeNull();
  });
});
