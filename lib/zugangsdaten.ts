import { decrypt, encrypt } from './crypto';

// Zugangsdaten von SMTP/IMAP-Postfächern: ein JSON {smtpPasswort, imapPasswort}, AES-256-GCM-verschlüsselt (lib/crypto.ts).
// Klartext-Passwörter verlassen den Server nie (weder an den Client noch in Logs).

export type Zugangsdaten = { smtpPasswort: string; imapPasswort: string };

export function verschluesseleZugangsdaten(z: Zugangsdaten): string {
  return encrypt(JSON.stringify({ smtpPasswort: z.smtpPasswort, imapPasswort: z.imapPasswort }));
}

/** Entschlüsselt die gespeicherten Passwörter; wirft bei fehlenden/unlesbaren Daten (z. B. geänderter ENCRYPTION_KEY). */
export function entschluesseleZugangsdaten(enc: string): Zugangsdaten {
  if (!enc) throw new Error('Keine Zugangsdaten gespeichert');
  const j = JSON.parse(decrypt(enc)) as Partial<Zugangsdaten>;
  if (typeof j.smtpPasswort !== 'string' || typeof j.imapPasswort !== 'string') throw new Error('Zugangsdaten unvollständig');
  return { smtpPasswort: j.smtpPasswort, imapPasswort: j.imapPasswort };
}
