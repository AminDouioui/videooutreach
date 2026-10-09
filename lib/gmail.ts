import { google } from 'googleapis';
import { decrypt, encrypt } from './crypto';
import { getEnv } from './env';
import { classifyGmailError, type GmailFehler } from './gmail-error';
import { deleteSetting, getSetting, setSetting } from './settings';

export { classifyGmailError };
export type { GmailFehler };

// Senden + nur Kopfzeilen lesen (für die Antwort-Erkennung der Follow-ups) – kein Zugriff auf Mail-Inhalte
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GMAIL_METADATA_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';

/** Funktion, die eine fertige base64url-Nachricht versendet (für Tests austauschbar). Mit threadId als Antwort im Thread. */
export type GmailSender = (raw: string, threadId?: string) => Promise<{ id: string; threadId: string }>;

/** Ergebnis der Thread-Prüfung: Antwort des Leads, Bounce oder nichts */
export type ThreadErgebnis = 'antwort' | 'bounce' | null;
/** Prüft einen Thread auf Antworten (für Tests austauschbar). Wirft GmailSendError. */
export type ThreadPruefer = (threadId: string) => Promise<ThreadErgebnis>;

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
    scope: [GMAIL_SCOPE, GMAIL_METADATA_SCOPE],
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
  // Tatsächlich erteilte Berechtigungen merken (Antwort-Erkennung braucht gmail.metadata)
  setSetting('gmail_scopes', tokens.scope ?? GMAIL_SCOPE);
  // gmail.send erlaubt kein Profil-Lesen: Konto-Adresse kommt aus SENDER_EMAIL
  const email = getEnv().SENDER_EMAIL;
  if (email) setSetting('gmail_email', email);
}

export function isGmailConnected(): boolean {
  return !!getSetting('gmail_refresh_token');
}

/** Darf die App Threads auf Antworten prüfen? (Verbindung vor der Follow-up-Funktion hat nur gmail.send) */
export function kannAntwortenPruefen(): boolean {
  return isGmailConnected() && (getSetting('gmail_scopes') ?? '').includes(GMAIL_METADATA_SCOPE);
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
  deleteSetting('gmail_scopes');
}

function gmailClient() {
  const enc = getSetting('gmail_refresh_token');
  if (!enc) throw new GmailSendError({ art: 'auth', meldung: 'Gmail nicht verbunden' });
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(enc) });
  return google.gmail({ version: 'v1', auth: client });
}

/** Standard-Sender über die Gmail-API. Wirft GmailSendError. */
export const sendRaw: GmailSender = async (raw, threadId) => {
  const gmail = gmailClient();
  try {
    const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw, ...(threadId ? { threadId } : {}) } });
    return { id: res.data.id ?? '', threadId: res.data.threadId ?? '' };
  } catch (e) {
    throw new GmailSendError(classifyGmailError(e));
  }
};

/** Bewertet die Kopfzeilen der Thread-Nachrichten (rein, testbar). Eigene Mails und Auto-Replies zählen nicht. */
export function bewerteThread(nachrichten: Array<Record<string, string>>, eigeneAdresse: string): ThreadErgebnis {
  const eigen = eigeneAdresse.trim().toLowerCase();
  let ergebnis: ThreadErgebnis = null;
  for (const h of nachrichten) {
    const von = (h['from'] ?? '').toLowerCase();
    if (!von || (eigen && von.includes(eigen))) continue;
    if (/mailer-daemon|postmaster/.test(von)) {
      ergebnis ??= 'bounce';
      continue;
    }
    // Abwesenheitsnotizen u. ä. (RFC 3834) beenden den Flow nicht
    const auto = (h['auto-submitted'] ?? 'no').toLowerCase();
    if (auto !== 'no' || h['x-autoreply'] || h['x-autorespond']) continue;
    return 'antwort';
  }
  return ergebnis;
}

/** Prüft per gmail.metadata (nur Kopfzeilen), ob im Thread eine Antwort oder ein Bounce liegt. */
export const pruefeThread: ThreadPruefer = async (threadId) => {
  const gmail = gmailClient();
  try {
    const res = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'metadata',
      metadataHeaders: ['From', 'Auto-Submitted', 'X-Autoreply', 'X-Autorespond'],
    });
    const nachrichten = (res.data.messages ?? []).map((m) => {
      const h: Record<string, string> = {};
      for (const x of m.payload?.headers ?? []) if (x.name && x.value) h[x.name.toLowerCase()] = x.value;
      return h;
    });
    return bewerteThread(nachrichten, connectedEmail() ?? '');
  } catch (e) {
    throw new GmailSendError(classifyGmailError(e));
  }
};
