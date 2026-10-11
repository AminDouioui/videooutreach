// Voreinstellungen für SMTP/IMAP-Postfächer (rein, auch im Browser nutzbar) und die gemeinsamen Typen

export type Sicherheit = 'ssl' | 'starttls' | 'keine';

export const SICHERHEIT_LABEL: Record<Sicherheit, string> = {
  ssl: 'SSL/TLS (direkt verschlüsselt)',
  starttls: 'STARTTLS',
  keine: 'Keine Verschlüsselung (unsicher)',
};

export type SmtpVorlage = {
  schluessel: string;
  name: string;
  smtpHost: string;
  smtpPort: number;
  smtpSicherheit: Sicherheit;
  imapHost: string;
  imapPort: number;
  imapSicherheit: Sicherheit;
  /** Legt der SMTP-Server gesendete Mails selbst im „Gesendet“-Ordner ab? Dann keine zweite Kopie per IMAP. */
  serverSpeichertGesendet: boolean;
  /** Hinweis, der beim Auswählen angezeigt wird */
  hinweis: string;
};

export const SMTP_VORLAGEN: SmtpVorlage[] = [
  {
    schluessel: 'outlook',
    name: 'Outlook / Microsoft 365',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSicherheit: 'starttls',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSicherheit: 'ssl',
    serverSpeichertGesendet: true,
    hinweis:
      'Microsoft 365: „SMTP AUTH“ muss im Tenant bzw. für das Postfach aktiviert sein (Exchange Admin Center → Postfach → E-Mail-Apps). Microsoft hat die einfache Anmeldung (Basic Auth) für viele Tenants abgeschaltet – dann funktioniert nur ein App-Passwort (bei aktivierter Zwei-Faktor-Anmeldung) oder der Zugang bleibt gesperrt. Reine OAuth-Anmeldung wird hier nicht unterstützt.',
  },
  {
    schluessel: 'ionos',
    name: 'IONOS',
    smtpHost: 'smtp.ionos.de',
    smtpPort: 465,
    smtpSicherheit: 'ssl',
    imapHost: 'imap.ionos.de',
    imapPort: 993,
    imapSicherheit: 'ssl',
    serverSpeichertGesendet: false,
    hinweis: 'IONOS: Benutzername ist die vollständige E-Mail-Adresse.',
  },
  {
    schluessel: 'strato',
    name: 'Strato',
    smtpHost: 'smtp.strato.de',
    smtpPort: 465,
    smtpSicherheit: 'ssl',
    imapHost: 'imap.strato.de',
    imapPort: 993,
    imapSicherheit: 'ssl',
    serverSpeichertGesendet: false,
    hinweis: 'Strato: Benutzername ist die vollständige E-Mail-Adresse, das Passwort das des Postfachs.',
  },
  {
    schluessel: 'webde',
    name: 'web.de',
    smtpHost: 'smtp.web.de',
    smtpPort: 587,
    smtpSicherheit: 'starttls',
    imapHost: 'imap.web.de',
    imapPort: 993,
    imapSicherheit: 'ssl',
    serverSpeichertGesendet: false,
    hinweis: 'web.de: In den Einstellungen muss der Abruf per POP3/IMAP erlaubt sein. Für den Massenversand sind web.de-Postfächer wegen strenger Limits wenig geeignet.',
  },
  {
    schluessel: 'gmx',
    name: 'GMX',
    smtpHost: 'mail.gmx.net',
    smtpPort: 587,
    smtpSicherheit: 'starttls',
    imapHost: 'imap.gmx.net',
    imapPort: 993,
    imapSicherheit: 'ssl',
    serverSpeichertGesendet: false,
    hinweis: 'GMX: In den Einstellungen muss der Abruf per POP3/IMAP erlaubt sein. Für den Massenversand sind GMX-Postfächer wegen strenger Limits wenig geeignet.',
  },
  {
    schluessel: 'sonstige',
    name: 'Sonstige',
    smtpHost: '',
    smtpPort: 587,
    smtpSicherheit: 'starttls',
    imapHost: '',
    imapPort: 993,
    imapSicherheit: 'ssl',
    serverSpeichertGesendet: false,
    hinweis: 'Server, Ports und Verschlüsselung stehen in der Anleitung Ihres Anbieters. Üblich: SMTP 465 (SSL) oder 587 (STARTTLS), IMAP 993 (SSL).',
  },
];

export function findeVorlage(schluessel: string): SmtpVorlage | undefined {
  return SMTP_VORLAGEN.find((v) => v.schluessel === schluessel);
}

/** Übliche Standardports je Verschlüsselung (für den Hinweis bei ungewöhnlichen Kombinationen) */
export const UNSICHER_HINWEIS = 'Ohne Verschlüsselung gehen Zugangsdaten und Mails im Klartext über das Netz. Nur in einem vertrauenswürdigen internen Netz verwenden.';
