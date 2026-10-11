import { describe, expect, it } from 'vitest';
import { imapAdressen, istSmtpThread, istZustellbericht, messageIdAusThread, messageIdsAus, normalisiereMessageId, ordneNachrichtenZu, smtpThreadId, type ImapKandidat } from './imap-zuordnung';

const EIGEN = 'amin@prozessia.de';
const MID = '<a1b2c3@prozessia.de>';
const T_ERST = Date.parse('2026-07-15T09:00:00Z');
const kontext = { eigeneAdresse: EIGEN, messageIds: [MID], leadAdresse: 'k@kunde.de', seit: T_ERST };
const k = (kopf: Record<string, string>, datum: number | null = T_ERST + 3600_000, textauszug?: string): ImapKandidat => ({ kopf, datum, textauszug });

describe('SMTP-Thread-IDs', () => {
  it('Präfix smtp: + Message-ID, Rückweg und Erkennung', () => {
    expect(smtpThreadId(MID)).toBe('smtp:<a1b2c3@prozessia.de>');
    expect(istSmtpThread('smtp:<x@y.de>')).toBe(true);
    expect(istSmtpThread('18f3a2b4c5d6e7f8')).toBe(false);
    expect(istSmtpThread(null)).toBe(false);
    expect(messageIdAusThread('smtp:<x@y.de>')).toBe('<x@y.de>');
    expect(messageIdAusThread('abc')).toBe('abc');
  });
  it('Message-IDs werden normalisiert und aus References gezogen', () => {
    expect(normalisiereMessageId(' <AbC@Prozessia.DE> ')).toBe('abc@prozessia.de');
    expect(messageIdsAus('<a@x.de>\r\n <b@y.de>  <c@z.de>')).toEqual(['a@x.de', 'b@y.de', 'c@z.de']);
    expect(messageIdsAus(undefined)).toEqual([]);
  });
  it('Adressen aus To-Zeilen, auch mit Komma im Namen', () => {
    expect(imapAdressen('"Müller, Hans" <H@Kunde.de>, anna@kunde.de; H@kunde.de')).toEqual(['h@kunde.de', 'anna@kunde.de']);
  });
});

describe('Antwort-Zuordnung aus IMAP-Kopfzeilen', () => {
  it('keine Kandidaten → null', () => {
    expect(ordneNachrichtenZu([], kontext)).toBeNull();
  });
  it('Antwort mit In-Reply-To auf unsere Message-ID', () => {
    expect(ordneNachrichtenZu([k({ from: 'Kunde <k@kunde.de>', 'in-reply-to': MID, subject: 'Re: Hallo' })], kontext)).toBe('antwort');
  });
  it('Antwort mit unserer ID nur in References (Kette), auch von anderer Adresse (Kollege)', () => {
    expect(ordneNachrichtenZu([k({ from: 'Kollege <kollege@kunde.de>', references: '<x@y.de> <A1B2C3@prozessia.de> <z@y.de>', subject: 'AW: Hallo' })], kontext)).toBe('antwort');
  });
  it('Mail vom Lead ohne Bezug nach der Erstmail zählt als Antwort, davor nicht', () => {
    expect(ordneNachrichtenZu([k({ from: 'k@kunde.de', subject: 'Etwas ganz anderes' })], kontext)).toBe('antwort');
    expect(ordneNachrichtenZu([k({ from: 'k@kunde.de', subject: 'Alt' }, T_ERST - 5 * 24 * 3600_000)], kontext)).toBeNull();
  });
  it('fremde Mails ohne Bezug (andere Leads im selben Postfach) werden ignoriert', () => {
    expect(ordneNachrichtenZu([k({ from: 'Newsletter <news@anbieter.de>', subject: 'Angebot' }), k({ from: 'x@anderer.de', 'in-reply-to': '<fremd@prozessia.de>' })], kontext)).toBeNull();
  });
  it('eigene Nachrichten zählen nie', () => {
    expect(ordneNachrichtenZu([k({ from: `Amin <${EIGEN}>`, 'in-reply-to': MID })], kontext)).toBeNull();
  });
  it('Abwesenheitsnotiz mit Bezug → abwesenheit, eine echte Antwort danach entscheidet', () => {
    const abw = k({ from: 'k@kunde.de', 'in-reply-to': MID, subject: 'Automatische Antwort: Hallo', 'auto-submitted': 'auto-replied' });
    expect(ordneNachrichtenZu([abw], kontext)).toBe('abwesenheit');
    expect(ordneNachrichtenZu([abw, k({ from: 'k@kunde.de', 'in-reply-to': MID, subject: 'Re: Hallo' })], kontext)).toBe('antwort');
  });
  it('Abwesenheit allein am Betreff (Out of Office) wird erkannt', () => {
    expect(ordneNachrichtenZu([k({ from: 'k@kunde.de', 'in-reply-to': MID, subject: 'Out of Office' })], kontext)).toBe('abwesenheit');
  });
});

describe('Bounce-Zuordnung', () => {
  const bounce = { from: 'Mail Delivery Subsystem <MAILER-DAEMON@mx.example.org>', subject: 'Undelivered Mail Returned to Sender' };
  it('Bounce, dessen Text unsere Message-ID nennt → bounce', () => {
    expect(ordneNachrichtenZu([k(bounce, null, `Final-Recipient: rfc822; k@kunde.de\r\nMessage-ID: ${MID}\r\n`)], kontext)).toBe('bounce');
  });
  it('Bounce mit unserer ID in Kopfzeile (In-Reply-To/References) → bounce', () => {
    expect(ordneNachrichtenZu([k({ ...bounce, references: MID })], kontext)).toBe('bounce');
  });
  it('Bounce für eine andere Mail (andere Message-ID) → null, stoppt diesen Lead nicht', () => {
    expect(ordneNachrichtenZu([k(bounce, null, 'Message-ID: <anderer-lead@prozessia.de>')], kontext)).toBeNull();
  });
  it('postmaster zählt, Message-ID wird ohne Beachtung der Groß-/Kleinschreibung gefunden', () => {
    expect(ordneNachrichtenZu([k({ from: 'postmaster@kunde.de', subject: 'Zustellung fehlgeschlagen' }, null, 'message-id: <A1B2C3@PROZESSIA.DE>')], kontext)).toBe('bounce');
  });
  it('multipart/report mit delivery-status gilt als Bounce, auch bei anderem Absender', () => {
    const kopf = { from: 'Mail Gateway <gateway@kunde.de>', 'content-type': 'multipart/report; report-type=delivery-status; boundary="x"', references: MID };
    expect(istZustellbericht(kopf)).toBe(true);
    expect(ordneNachrichtenZu([k(kopf)], kontext)).toBe('bounce');
    // Lesebestätigung ist kein Zustellbericht
    expect(istZustellbericht({ 'content-type': 'multipart/report; report-type=disposition-notification' })).toBe(false);
  });
  it('mehrere unserer Message-IDs (Follow-ups): Bounce der Follow-up-Mail wird dem Lead zugeordnet', () => {
    const ctx = { ...kontext, messageIds: [MID, '<folge1@prozessia.de>'] };
    expect(ordneNachrichtenZu([k(bounce, null, 'Message-ID: <folge1@prozessia.de>')], ctx)).toBe('bounce');
  });
  it('echte Antwort schlägt Bounce', () => {
    expect(ordneNachrichtenZu([k({ ...bounce, references: MID }), k({ from: 'k@kunde.de', 'in-reply-to': MID, subject: 'Re: Hallo' })], kontext)).toBe('antwort');
  });
});
