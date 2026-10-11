import { describe, expect, it } from 'vitest';
import { entferneSchlussgruss, korrekturHinweis, pruefeSchreibregeln, verstossLabels } from './schreibregeln';

const regeln = (t: string, opt?: { gespraech?: boolean }) => pruefeSchreibregeln(t, opt).map((v) => v.regel);

describe('pruefeSchreibregeln: Stilregeln', () => {
  it('erkennt Gedankenstriche', () => {
    expect(regeln('Das ist gut – wirklich')).toEqual(['gedankenstrich']);
    expect(regeln('Das ist gut — wirklich')).toEqual(['gedankenstrich']);
  });

  it('erkennt Bindestriche als Trenner, nicht in zusammengesetzten Wörtern', () => {
    expect(regeln('Das ist gut - wirklich')).toEqual(['trenner']);
    expect(regeln('Eine E-Mail zur KI-gestützten Auswertung der Thermo-Technik')).toEqual([]);
  });

  it('erkennt runde Klammern einzeln', () => {
    expect(regeln('Das (hier) passt')).toEqual(['klammern', 'klammern']);
  });

  it('liefert Fundstelle mit Markierung im Ausschnitt', () => {
    const text = 'Wir automatisieren Angebote – schnell und sicher für Ihr Team.';
    const [v] = pruefeSchreibregeln(text);
    expect(v.label).toBe('Gedankenstrich (– —)');
    expect(text.slice(v.von, v.bis)).toBe('–');
    expect(v.stelle.slice(v.markVon, v.markBis)).toBe('–');
    expect(v.stelle).toContain('Angebote');
  });

  it('Markierung stimmt auch bei gekürztem Ausschnitt (…)', () => {
    const text = `${'a '.repeat(40)}(Klammer)${' b'.repeat(40)}`;
    const [v] = pruefeSchreibregeln(text);
    expect(v.stelle.startsWith('…')).toBe(true);
    expect(v.stelle.slice(v.markVon, v.markBis)).toBe('(');
  });

  it('Platzhalter und Spintax sind keine Klammern', () => {
    expect(regeln('{{begruessung}}, {Hallo|Guten Tag} {{vorname|Hallo zusammen}}')).toEqual([]);
  });

  it('Platzhalter mit Fallback verfälschen die Positionen nicht', () => {
    const text = '{{vorname|Hallo zusammen}} – Test';
    const [v] = pruefeSchreibregeln(text);
    expect(text.slice(v.von, v.bis)).toBe('–');
  });

  it('Klammern und Striche in URLs werden ignoriert', () => {
    expect(regeln('Siehe https://example.de/a_(b)/seite – hier')).toEqual(['gedankenstrich']);
    expect(regeln('Termin: https://cal.example/termin-30 - bitte')).toEqual(['trenner']);
    expect(regeln('Mehr unter https://example.de/info/x_(y)/z')).toEqual([]);
  });

  it('Satzzeichen hinter einer URL bleiben Text', () => {
    expect(regeln('Link (https://example.de/a).')).toEqual(['klammern', 'klammern']);
  });

  it('Aufzählungsstrich am Zeilenanfang zählt als Trenner', () => {
    expect(regeln('Vorteile:\n- schnell\n- sicher')).toEqual(['trenner', 'trenner']);
  });

  it('sauberer Text ohne Treffer', () => {
    expect(regeln('Guten Tag Herr Müller, vielen Dank für Ihre Nachricht. Gern sprechen wir kurz: Dienstag oder Mittwoch?')).toEqual([]);
  });
});

describe('pruefeSchreibregeln: Wahrheitsregel', () => {
  it.each([
    'Danke für unser Telefonat.',
    'Vielen Dank für das Gespräch.',
    'Wie besprochen sende ich Ihnen die Unterlagen.',
    'Wie telefonisch besprochen folgt der Link.',
    'Ich habe mit Ihrer Abteilung telefoniert.',
    'Wie schön war unser kurzes Gespräch.',
    'Nach dem Telefonat mit Ihnen melde ich mich.',
  ])('erkennt: %s', (t) => {
    expect(regeln(t)).toContain('gespraech');
  });

  it('ehrliche Formulierungen schlagen nicht an', () => {
    expect(regeln('Ich habe bei Ihrer Firma angerufen und wurde an Sie verwiesen. Danke für Ihre Nachricht und Ihre Zeit.')).toEqual([]);
  });

  it('lässt sich abschalten (Senden einer Antwort)', () => {
    expect(regeln('Wie besprochen schicke ich das Angebot.', { gespraech: false })).toEqual([]);
  });
});

describe('verstossLabels / korrekturHinweis', () => {
  it('nennt jede Regel einmal', () => {
    const v = pruefeSchreibregeln('A (b) und (c) – d');
    expect(verstossLabels(v)).toEqual(['Klammern', 'Gedankenstrich (– —)']);
    expect(korrekturHinweis(v)).toContain('Klammern, Gedankenstrich');
  });
});

describe('entferneSchlussgruss', () => {
  it('entfernt Gruß mit Name und Firma', () => {
    expect(entferneSchlussgruss('Gern am Dienstag.\n\nBeste Grüße\nSebastian Spuhler\nProzessia', 'Sebastian Spuhler')).toBe('Gern am Dienstag.');
  });

  it('entfernt „Mit freundlichen Grüßen,“ mit Komma und Name in derselben Zeile', () => {
    expect(entferneSchlussgruss('Text.\n\nMit freundlichen Grüßen,\nAmin', 'Amin Douioui')).toBe('Text.');
    expect(entferneSchlussgruss('Text.\n\nViele Grüße, Amin', 'Amin Douioui')).toBe('Text.');
  });

  it('entfernt nur den Namen, wenn er allein am Ende steht', () => {
    expect(entferneSchlussgruss('Text.\n\nAmin Douioui', 'Amin Douioui')).toBe('Text.');
    expect(entferneSchlussgruss('Text.\n\nAmin', 'Amin Douioui')).toBe('Text.');
  });

  it('lässt Text ohne Gruß und Grüße mitten im Text unverändert', () => {
    const t = 'Viele Grüße an Ihr Team richte ich gern aus.\n\nDer Termin passt mir gut, ich schicke Ihnen die Einladung.';
    expect(entferneSchlussgruss(t, 'Amin')).toBe(t);
  });

  it('entfernt keinen langen Nachlauf (echter Text nach dem Gruß)', () => {
    const t = 'Beste Grüße\nDa ich Ihnen vorab noch eine längere Information zum Ablauf geben möchte, schreibe ich hier weiter und weiter.';
    expect(entferneSchlussgruss(t, 'Amin')).toBe(t);
  });

  it('CRLF und Leerzeilen am Ende', () => {
    expect(entferneSchlussgruss('Text.\r\n\r\nBeste Grüße\r\nAmin\r\n\r\n', 'Amin')).toBe('Text.');
  });
});
