import { describe, expect, it } from 'vitest';
import { classifyImapError, classifySmtpError } from './smtp-fehler';

describe('SMTP-Fehler', () => {
  it('Anmeldefehler → auth mit Hinweis auf Passwort/App-Passwort', () => {
    const f = classifySmtpError({ code: 'EAUTH', responseCode: 535, response: '535 5.7.3 Authentication unsuccessful', message: 'Invalid login' });
    expect(f.art).toBe('auth');
    expect(f.meldung).toMatch(/App-Passwort/);
  });
  it('Microsoft: SMTP AUTH deaktiviert (530 5.7.57) → auth', () => {
    expect(classifySmtpError({ responseCode: 530, response: '530 5.7.57 Client not authenticated to send mail' }).art).toBe('auth');
  });
  it('Tageslimit des Anbieters → quota', () => {
    expect(classifySmtpError({ responseCode: 550, response: '550 5.4.5 Daily user sending quota exceeded' }).art).toBe('quota');
    expect(classifySmtpError({ responseCode: 452, response: '452 4.5.3 Too many recipients' }).art).toBe('quota');
  });
  it('unbekannter Empfänger → ungültiger Empfänger', () => {
    expect(classifySmtpError({ responseCode: 550, response: '550 5.1.1 User unknown' }).art).toBe('ungueltiger_empfaenger');
    expect(classifySmtpError({ code: 'EENVELOPE', message: 'No recipients defined' }).art).toBe('ungueltiger_empfaenger');
  });
  it('Netzwerkfehler → sonstig mit verständlichem Hinweis (kein Postfach-Stopp)', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET']) {
      const f = classifySmtpError({ code, message: `connect ${code} smtp.example.de:587` });
      expect(f.art).toBe('sonstig');
      expect(f.meldung).toMatch(/Keine Verbindung zum SMTP-Server/);
    }
  });
  it('Zertifikat/TLS → sonstig mit Hinweis auf Verschlüsselung', () => {
    const f = classifySmtpError({ code: 'ESOCKET', message: 'self-signed certificate' });
    expect(f.art).toBe('sonstig');
    expect(f.meldung).toMatch(/Zertifikat|Verschlüsselung/);
  });
  it('Unbekanntes bleibt lesbar', () => {
    expect(classifySmtpError(new Error('komisch')).meldung).toContain('komisch');
    expect(classifySmtpError(undefined).meldung).toContain('SMTP-Fehler');
  });
});

describe('IMAP-Fehler', () => {
  it('Anmeldefehler → auth', () => {
    expect(classifyImapError({ authenticationFailed: true, responseText: 'Invalid credentials' }).art).toBe('auth');
    expect(classifyImapError({ code: 'AUTHENTICATIONFAILED', message: 'Command failed' }).art).toBe('auth');
    expect(classifyImapError({ message: 'LOGIN failed.' }).art).toBe('auth');
  });
  it('Netz → sonstig, später erneut', () => {
    const f = classifyImapError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND imap.example.de' });
    expect(f.art).toBe('sonstig');
    expect(f.meldung).toMatch(/Keine Verbindung zum IMAP-Server/);
    expect(classifyImapError({ code: 'CONNECT_TIMEOUT', message: 'x' }).meldung).toMatch(/Keine Verbindung/);
  });
});
