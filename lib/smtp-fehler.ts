import type { GmailFehler } from './gmail-error';

// Fehlerklassifizierung für SMTP (nodemailer) und IMAP (imapflow) – rein, ohne Netz. Liefert dieselben Arten wie bei
// Gmail (quota / ungültiger Empfänger / auth / sonstig), damit Versand, Rotation und Pausierung gleich funktionieren.

type Fehlerobjekt = {
  code?: string | number;
  command?: string;
  response?: string;
  responseCode?: number | string;
  responseText?: string;
  message?: string;
  authenticationFailed?: boolean;
  serverResponseCode?: string;
};

const NETZ = /\b(enotfound|econnrefused|econnreset|etimedout|esockettimedout|econnection|eai_again|enetunreach|ehostunreach|epipe|econnaborted|connect_timeout|dns|socket|timeout|timed out)\b/i;
const ZERTIFIKAT = /(certificate|self[- ]signed|cert_|unable to verify|hostname\/ip does not match|altnames)/i;

function text(e: unknown): { err: Fehlerobjekt; roh: string } {
  const err = (e ?? {}) as Fehlerobjekt;
  const roh = [err.responseText, err.response, err.message, typeof e === 'string' ? e : ''].filter(Boolean).join(' – ');
  return { err, roh: roh || 'Unbekannter Fehler' };
}

/** SMTP-Fehler → Kategorie mit deutscher Meldung. */
export function classifySmtpError(e: unknown): GmailFehler {
  const { err, roh } = text(e);
  const code = String(err.code ?? '').toUpperCase();
  const status = Number(err.responseCode ?? (/^\s*(\d{3})[ -]/.exec(err.response ?? '')?.[1] ?? NaN));
  const kurz = roh.slice(0, 300);
  const l = roh.toLowerCase();

  if (code === 'EAUTH' || status === 535 || status === 534 || status === 530 || /authentication (failed|unsuccessful)|invalid credentials|auth.*(failed|rejected)|username and password not accepted|5\.7\.(3|8)\b/i.test(roh)) {
    return { art: 'auth', meldung: `SMTP-Anmeldung fehlgeschlagen – bitte Benutzername und Passwort (bei Microsoft 365: App-Passwort bzw. aktiviertes SMTP AUTH) prüfen: ${kurz}` };
  }
  // Tages-/Mengenlimits des Anbieters
  if (/5\.4\.5|daily (user )?sending (quota|limit)|sending limit|quota exceeded|too many (messages|recipients|emails)|rate limit|ratelimit|limit exceeded|message limit/i.test(roh) || status === 452 || (status === 451 && /limit|too many/i.test(roh))) {
    return { art: 'quota', meldung: `Sendelimit des Anbieters erreicht: ${kurz}` };
  }
  if (code === 'EENVELOPE' || (status === 550 && /5\.1\.[0-9]|user unknown|no such user|recipient|mailbox (unavailable|not found)|does not exist/i.test(roh)) || status === 553 || status === 551 || /5\.1\.1\b|invalid (recipient|address)|user unknown|no such user/i.test(roh)) {
    return { art: 'ungueltiger_empfaenger', meldung: `Ungültige Empfängeradresse: ${kurz}` };
  }
  if (ZERTIFIKAT.test(roh) || /^ERR_TLS|^ERR_SSL|EPROTO|wrong version number/i.test(code + ' ' + l)) {
    return { art: 'sonstig', meldung: `Sichere Verbindung zum SMTP-Server nicht möglich (Zertifikat/Verschlüsselung): Host, Port und Verschlüsselung prüfen. (${kurz})` };
  }
  if (NETZ.test(`${code} ${roh}`) || code === 'ECONNECTION' || code === 'ESOCKET' || code === 'ETIMEDOUT') {
    return { art: 'sonstig', meldung: `Keine Verbindung zum SMTP-Server (Netzwerkfehler) – Host und Port prüfen bzw. später erneut versuchen. (${kurz})` };
  }
  return { art: 'sonstig', meldung: `SMTP-Fehler: ${kurz}` };
}

/** IMAP-Fehler → Kategorie mit deutscher Meldung. */
export function classifyImapError(e: unknown): GmailFehler {
  const { err, roh } = text(e);
  const code = String(err.code ?? '').toUpperCase();
  const kurz = roh.slice(0, 300);
  if (err.authenticationFailed || code === 'AUTHENTICATIONFAILED' || /authenticationfailed|authentication failed|invalid credentials|login failed|\[auth\]|logon failure|username and password/i.test(`${roh} ${err.serverResponseCode ?? ''}`)) {
    return { art: 'auth', meldung: `IMAP-Anmeldung fehlgeschlagen – bitte Benutzername und Passwort (bei Microsoft 365: App-Passwort) prüfen und ob IMAP für das Postfach erlaubt ist: ${kurz}` };
  }
  if (ZERTIFIKAT.test(roh) || /EPROTO|wrong version number|ERR_SSL/i.test(`${code} ${roh}`)) {
    return { art: 'sonstig', meldung: `Sichere Verbindung zum IMAP-Server nicht möglich (Zertifikat/Verschlüsselung): Host, Port und Verschlüsselung prüfen. (${kurz})` };
  }
  if (NETZ.test(`${code} ${roh}`) || code === 'CONNECT_TIMEOUT' || code === 'NOCONNECTION' || /connection (closed|not available)|greeting/i.test(roh)) {
    return { art: 'sonstig', meldung: `Keine Verbindung zum IMAP-Server (Netzwerkfehler) – Host und Port prüfen bzw. später erneut versuchen. (${kurz})` };
  }
  return { art: 'sonstig', meldung: `IMAP-Fehler: ${kurz}` };
}
