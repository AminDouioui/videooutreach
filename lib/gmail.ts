import { google } from 'googleapis';
import { decrypt, encrypt } from './crypto';
import { getEnv } from './env';
import { classifyGmailError, type GmailFehler } from './gmail-error';
import { deleteSetting, getSetting, setSetting } from './settings';

export { classifyGmailError };
export type { GmailFehler };

// Nur Senden – kein Lesen von Postfach oder Profil
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/** Funktion, die eine fertige base64url-Nachricht versendet (für Tests austauschbar). */
export type GmailSender = (raw: string) => Promise<{ id: string; threadId: string }>;

/** Fehler beim Versand mit Klassifizierung. */
export class GmailSendError extends Error {
  constructor(public readonly info: GmailFehler) {
    super(info.meldung);
  }
}

function oauthClient() {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET sind nicht gesetzt (siehe docs/gmail-einrichtung.md)');
  }
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

export function oauthConfigured(): boolean {
  const env = getEnv();
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** Zustimmungs-URL (offline + consent, damit immer ein Refresh-Token zurückkommt). */
export function buildAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [GMAIL_SCOPE],
    state,
    login_hint: getEnv().SENDER_EMAIL,
  });
}

/** Tauscht den Code gegen Tokens und speichert den Refresh-Token verschlüsselt. */
export async function handleCallbackCode(code: string): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google hat keinen Refresh-Token geliefert. Bitte den Zugriff unter myaccount.google.com/permissions entfernen und erneut verbinden.');
  }
  setSetting('gmail_refresh_token', encrypt(tokens.refresh_token));
  // gmail.send erlaubt kein Profil-Lesen: Konto-Adresse kommt aus SENDER_EMAIL
  const email = getEnv().SENDER_EMAIL;
  if (email) setSetting('gmail_email', email);
}

export function isGmailConnected(): boolean {
  return !!getSetting('gmail_refresh_token');
}

export function connectedEmail(): string | null {
  return getSetting('gmail_email') || getEnv().SENDER_EMAIL || null;
}

/** Trennt Gmail: Token wird (best effort) bei Google widerrufen und lokal gelöscht. */
export async function disconnectGmail(): Promise<void> {
  const enc = getSetting('gmail_refresh_token');
  if (enc) {
    try {
      await oauthClient().revokeToken(decrypt(enc));
    } catch {
      // Widerruf fehlgeschlagen (z. B. offline) – lokal trotzdem löschen
    }
  }
  deleteSetting('gmail_refresh_token');
  deleteSetting('gmail_email');
}

/** Standard-Sender über die Gmail-API. Wirft GmailSendError. */
export const sendRaw: GmailSender = async (raw) => {
  const enc = getSetting('gmail_refresh_token');
  if (!enc) throw new GmailSendError({ art: 'auth', meldung: 'Gmail nicht verbunden' });
  try {
    const client = oauthClient();
    client.setCredentials({ refresh_token: decrypt(enc) });
    const gmail = google.gmail({ version: 'v1', auth: client });
    const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    return { id: res.data.id ?? '', threadId: res.data.threadId ?? '' };
  } catch (e) {
    throw new GmailSendError(classifyGmailError(e));
  }
};
