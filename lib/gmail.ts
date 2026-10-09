import { google } from 'googleapis';
import { speichereVerbindung, type Absender } from './absender';
import { decrypt, encrypt } from './crypto';
import { getEnv } from './env';
import { classifyGmailError, type GmailFehler } from './gmail-error';
import { GMAIL_METADATA_SCOPE, GMAIL_SCOPE, OAUTH_SCOPES } from './gmail-scopes';

export { classifyGmailError, GMAIL_METADATA_SCOPE, GMAIL_SCOPE };
export type { GmailFehler };

/** Was die Gmail-Funktionen von einem Postfach brauchen */
export type GmailPostfach = Pick<Absender, 'id' | 'email' | 'refreshTokenEnc'>;

/**
 * Funktion, die eine fertige base64url-Nachricht über das Postfach versendet (für Tests austauschbar). Mit threadId
 * als Antwort im Thread. Das Postfach wird mitgegeben, damit Tests die Rotation prüfen können.
 */
export type GmailSender = (raw: string, threadId: string | undefined, postfach: GmailPostfach) => Promise<{ id: string; threadId: string }>;

/** Ergebnis der Thread-Prüfung: Antwort des Leads, Bounce oder nichts */
export type ThreadErgebnis = 'antwort' | 'bounce' | null;
/** Prüft einen Thread im Postfach der Erstmail auf Antworten (für Tests austauschbar). Wirft GmailSendError. */
export type ThreadPruefer = (threadId: string, postfach: GmailPostfach) => Promise<ThreadErgebnis>;

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

/** Zustimmungs-URL (offline + consent, damit immer ein Refresh-Token zurückkommt). `loginHint` = vorgeschlagenes Konto. */
export function buildAuthUrl(state: string, loginHint?: string): string {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: OAUTH_SCOPES,
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
}

/** Ergebnis des Code-Tauschs: was zum Speichern eines Postfachs nötig ist */
export type CodeAustausch = { refreshToken: string; scopes: string; email: string };

/** Tauscht den Code gegen Tokens und liest die Adresse aus dem ID-Token (verifyIdToken mit Client-ID). */
async function tauscheCode(code: string): Promise<CodeAustausch> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google hat keinen Refresh-Token geliefert. Bitte den Zugriff unter myaccount.google.com/permissions entfernen und erneut verbinden.');
  }
  if (!tokens.id_token) {
    throw new Error('Google hat kein ID-Token geliefert – die Berechtigungen „openid“ und „email“ fehlen im OAuth-Zustimmungsbildschirm (siehe docs/gmail-einrichtung.md).');
  }
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: getEnv().GOOGLE_CLIENT_ID });
  const email = ticket.getPayload()?.email?.trim().toLowerCase();
  if (!email) throw new Error('Im ID-Token von Google steht keine E-Mail-Adresse. Bitte „email“ im OAuth-Zustimmungsbildschirm ergänzen und erneut verbinden.');
  return { refreshToken: tokens.refresh_token, scopes: tokens.scope ?? GMAIL_SCOPE, email };
}

/**
 * OAuth-Rückkehr: Code tauschen und Postfach speichern (Refresh-Token verschlüsselt). Dieselbe Adresse erneut
 * verbinden aktualisiert den Token. `austausch` ersetzt den Google-Aufruf (Tests).
 */
export async function handleCallbackCode(code: string, austausch: (code: string) => Promise<CodeAustausch> = tauscheCode): Promise<{ email: string; neu: boolean }> {
  const a = await austausch(code);
  const { absender, neu } = speichereVerbindung({ email: a.email, refreshTokenEnc: encrypt(a.refreshToken), scopes: a.scopes });
  return { email: absender.email, neu };
}

/** Widerruft den Token des Postfachs bei Google (best effort; lokal wird separat gelöscht). */
export async function widerrufeToken(postfach: Pick<Absender, 'refreshTokenEnc'>): Promise<void> {
  if (!postfach.refreshTokenEnc) return;
  try {
    await oauthClient().revokeToken(decrypt(postfach.refreshTokenEnc));
  } catch {
    // Widerruf fehlgeschlagen (z. B. offline) – lokal trotzdem löschen
  }
}

function gmailClient(postfach: GmailPostfach) {
  if (!postfach.refreshTokenEnc) throw new GmailSendError({ art: 'auth', meldung: `Postfach ${postfach.email} nicht verbunden` });
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(postfach.refreshTokenEnc) });
  return google.gmail({ version: 'v1', auth: client });
}

/** Standard-Sender über die Gmail-API (im Namen des übergebenen Postfachs). Wirft GmailSendError. */
export const sendRaw: GmailSender = async (raw, threadId, postfach) => {
  const gmail = gmailClient(postfach);
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
export const pruefeThread: ThreadPruefer = async (threadId, postfach) => {
  const gmail = gmailClient(postfach);
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
    return bewerteThread(nachrichten, postfach.email);
  } catch (e) {
    throw new GmailSendError(classifyGmailError(e));
  }
};
