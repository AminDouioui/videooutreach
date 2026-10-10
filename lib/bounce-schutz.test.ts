import { describe, expect, it } from 'vitest';
import { berechneBounceQuote, istBounceFehler, kampagnePausiertGrund, postfachBounceFehler } from './bounce-schutz';

const proben = (gesendet: number, bounces: number) => Array.from({ length: gesendet }, (_, i) => i < bounces);

describe('Bounce-Quote', () => {
  it('schlägt unter 20 gesendeten Mails nie an', () => {
    const q = berechneBounceQuote(proben(19, 19), { schwelleProzent: 5, fenster: 50 });
    expect(q).toMatchObject({ gesendet: 19, ausreichend: false, ueberSchwelle: false, prozent: 100 });
  });
  it('genau auf der Schwelle ist noch ok, darüber nicht', () => {
    expect(berechneBounceQuote(proben(40, 2), { schwelleProzent: 5, fenster: 50 }).ueberSchwelle).toBe(false);
    const q = berechneBounceQuote(proben(40, 3), { schwelleProzent: 5, fenster: 50 });
    expect(q).toMatchObject({ prozent: 7.5, bounces: 3, ueberSchwelle: true });
  });
  it('berücksichtigt nur die letzten N Erstmails (neueste zuerst)', () => {
    // 5 Bounces ganz am Anfang der Liste (neueste), danach 95 saubere: Fenster 50 -> 10 %
    const liste = [...proben(5, 5), ...proben(95, 0)];
    expect(berechneBounceQuote(liste, { schwelleProzent: 5, fenster: 50 })).toMatchObject({ gesendet: 50, bounces: 5, prozent: 10, ueberSchwelle: true });
    // Alte Bounces außerhalb des Fensters zählen nicht
    const alt = [...proben(50, 0), ...proben(10, 10)];
    expect(berechneBounceQuote(alt, { schwelleProzent: 5, fenster: 50 }).bounces).toBe(0);
  });
  it('leere Liste', () => expect(berechneBounceQuote([], { schwelleProzent: 5, fenster: 50 })).toMatchObject({ gesendet: 0, prozent: 0, ueberSchwelle: false }));
  it('Texte', () => {
    const q = berechneBounceQuote(proben(40, 4), { schwelleProzent: 5, fenster: 50 });
    expect(postfachBounceFehler(q)).toBe('Bounce-Quote zu hoch (10 %)');
    expect(istBounceFehler(postfachBounceFehler(q))).toBe(true);
    expect(istBounceFehler('invalid_grant')).toBe(false);
    expect(kampagnePausiertGrund(q, 5)).toContain('10 %');
  });
});
