import { describe, expect, it } from 'vitest';
import { OFFENE_MARKER, SECHS_MAILS_ERSTMAIL, SECHS_MAILS_FOLLOWUPS } from './kampagne-sechs-mails';
import { pruefeSchreibregeln } from './schreibregeln';
import { pruefeVorlage, STANDARD_VARIABLEN } from './vorlage';

const mails = [
  { betreff: SECHS_MAILS_ERSTMAIL.betreff, text: SECHS_MAILS_ERSTMAIL.text },
  ...SECHS_MAILS_FOLLOWUPS.map((f) => ({ betreff: f.betreff, text: f.body })),
];

describe('Sechs-Mails-Sequenz', () => {
  it('hat sechs Mails', () => expect(mails).toHaveLength(6));

  it('hält die Schreibregeln ein', () => {
    for (const m of mails) {
      expect(pruefeSchreibregeln(m.betreff, { gespraech: true })).toEqual([]);
      expect(pruefeSchreibregeln(m.text, { gespraech: true })).toEqual([]);
    }
  });

  it('nutzt nur bekannte Platzhalter und balancierte Klammern', () => {
    for (const m of mails) {
      for (const t of [m.betreff, m.text]) {
        const p = pruefeVorlage(t, STANDARD_VARIABLEN);
        expect(p.fehler).toEqual([]);
        expect(p.unbekannt).toEqual([]);
      }
    }
  });

  it('nennt das Produkt erst in Mail 5 und zeigt das Video nur dort', () => {
    mails.forEach((m, i) => {
      expect(/Beschaffungsagent|Prozessia/.test(m.text)).toBe(i === 4);
      expect(m.text.includes('{{vorschaubild}}')).toBe(i === 4);
    });
  });

  it('bleibt kurz (höchstens 130 Wörter je Mail) und fragt nicht nach einem Anruf', () => {
    for (const m of mails) {
      expect(m.text.split(/\s+/).length).toBeLessThanOrEqual(130);
      expect(/Haben Sie Zeit|Sind Sie .*verfügbar|Telefonat/i.test(m.text)).toBe(false);
    }
  });

  it('kennzeichnet offene Angaben des Kundenbeispiels nur in Mail 3', () => {
    mails.forEach((m, i) => expect((m.text.match(OFFENE_MARKER) ?? []).length > 0).toBe(i === 2));
  });
});
