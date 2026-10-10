import { describe, expect, it } from 'vitest';
import { bewerteNachrichten, betreffIstAbwesenheit, istAbwesenheit, istBounce, klassifiziereNachricht } from './autoreply';

const kunde = 'Max Kunde <max@kunde.de>';

describe('Abwesenheit über Header', () => {
  it('Auto-Submitted ungleich "no" ist automatisch', () => {
    expect(istAbwesenheit({ from: kunde, 'auto-submitted': 'auto-replied' })).toBe(true);
    expect(istAbwesenheit({ from: kunde, 'auto-submitted': 'auto-generated' })).toBe(true);
    expect(istAbwesenheit({ from: kunde, 'auto-submitted': 'no' })).toBe(false);
    expect(istAbwesenheit({ from: kunde, 'auto-submitted': ' No ' })).toBe(false);
    expect(istAbwesenheit({ from: kunde })).toBe(false);
  });
  it('X-Autoreply und X-Autorespond', () => {
    expect(istAbwesenheit({ from: kunde, 'x-autoreply': 'yes' })).toBe(true);
    expect(istAbwesenheit({ from: kunde, 'x-autorespond': 'yes' })).toBe(true);
  });
  it('Precedence auto_reply, bulk und junk', () => {
    for (const p of ['auto_reply', 'auto-reply', 'Bulk', 'junk']) expect(istAbwesenheit({ from: kunde, precedence: p })).toBe(true);
    expect(istAbwesenheit({ from: kunde, precedence: 'list' })).toBe(false);
  });
  it('X-Auto-Response-Suppress allein ist kein Beweis, mit Betreff schon', () => {
    expect(istAbwesenheit({ from: kunde, 'x-auto-response-suppress': 'All', subject: 'Re: Ihr Video' })).toBe(false);
    expect(istAbwesenheit({ from: kunde, 'x-auto-response-suppress': 'All', subject: 'Automatische Antwort: Ihr Video' })).toBe(true);
  });
});

describe('Abwesenheit über Betreff', () => {
  const treffer = [
    'Abwesenheit',
    'Abwesenheitsnotiz: Re: Ihr Video',
    'Automatische Antwort: Ihr Video',
    'Automatische Antwort: Re: Hallo',
    'Ich bin abwesend',
    'Autoantwort: Hallo',
    'Out of Office',
    'Out of the office until Monday',
    'Automatic reply: Your video',
    'Autoreply: hello',
    'Auto-Reply: hello',
    'Automatic response',
    'Away from my desk',
    'Réponse automatique : Votre vidéo',
    'Message d’absence',
    'Absent du bureau',
    'Fuera de la oficina',
    'Respuesta automática: Su vídeo',
    'Risposta automatica: il tuo video',
    'Fuori sede',
    'Automatisch antwoord: Uw video',
    'Afwezigheidsmelding',
    'Buiten kantoor',
  ];
  it.each(treffer)('erkennt „%s“', (betreff) => {
    expect(betreffIstAbwesenheit(betreff)).toBe(true);
    expect(istAbwesenheit({ from: kunde, subject: betreff })).toBe(true);
  });
  const keine = ['Re: Ihr Video', 'Gerne, Termin passt', 'Interesse an Ihrem Angebot', 'Re: Hallo Rittal', ''];
  it.each(keine)('echte Antwort: „%s“', (betreff) => {
    expect(betreffIstAbwesenheit(betreff)).toBe(false);
    expect(klassifiziereNachricht({ from: kunde, subject: betreff })).toBe('antwort');
  });
});

describe('Bounces', () => {
  it('mailer-daemon und postmaster', () => {
    expect(istBounce({ from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>' })).toBe(true);
    expect(istBounce({ from: 'postmaster@kunde.de' })).toBe(true);
    expect(istBounce({ from: kunde })).toBe(false);
  });
  it('Delivery Status Notification im Betreff', () => {
    expect(istBounce({ from: 'noreply@x.de', subject: 'Delivery Status Notification (Failure)' })).toBe(true);
    expect(istBounce({ from: 'noreply@x.de', subject: 'Undeliverable: Hallo' })).toBe(true);
    expect(istBounce({ from: kunde, subject: 'Re: Delivery Status Notification' })).toBe(false);
  });
  it('Bounce hat Vorrang vor Abwesenheit', () => {
    const dsn = { from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', 'auto-submitted': 'auto-replied', subject: 'Delivery Status Notification (Failure)' };
    expect(klassifiziereNachricht(dsn)).toBe('bounce');
    expect(klassifiziereNachricht({ from: 'postmaster@kunde.de', subject: 'Automatic reply', 'x-autoreply': 'yes' })).toBe('bounce');
  });
});

describe('Thread-Bewertung', () => {
  it('leer = nichts', () => expect(bewerteNachrichten([])).toBeNull());
  it('nur Abwesenheit', () => expect(bewerteNachrichten(['abwesenheit'])).toBe('abwesenheit'));
  it('spätere echte Antwort nach Abwesenheit', () => expect(bewerteNachrichten(['abwesenheit', 'antwort'])).toBe('antwort'));
  it('echte Antwort vor späterer Abwesenheit bleibt Antwort', () => expect(bewerteNachrichten(['antwort', 'abwesenheit'])).toBe('antwort'));
  it('Bounce ohne Antwort', () => expect(bewerteNachrichten(['bounce'])).toBe('bounce'));
  it('Bounce und Abwesenheit: die neueste entscheidet', () => {
    expect(bewerteNachrichten(['abwesenheit', 'bounce'])).toBe('bounce');
    expect(bewerteNachrichten(['bounce', 'abwesenheit'])).toBe('abwesenheit');
  });
});
