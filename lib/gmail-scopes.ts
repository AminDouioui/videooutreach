// Gmail-/OpenID-Scopes (eigene Datei, damit Datenbank- und API-Module sie ohne Import-Zyklus nutzen können)

// Senden + nur Kopfzeilen lesen (für die Antwort-Erkennung der Follow-ups) – kein Zugriff auf Mail-Inhalte
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GMAIL_METADATA_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';
// Optional (Unibox): Nachrichten und Threads lesen. „Eingeschränkter“ Scope – für interne Apps in Google Workspace ohne Prüfung nutzbar
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
// openid + email: die Adresse des verbundenen Kontos kommt aus dem ID-Token (gmail.send erlaubt kein Profil-Lesen)
export const OPENID_SCOPE = 'openid';
export const EMAIL_SCOPE = 'email';

export const OAUTH_SCOPES = [GMAIL_SCOPE, GMAIL_METADATA_SCOPE, OPENID_SCOPE, EMAIL_SCOPE];

/** Zusätzlich beim „Lesezugriff erteilen“ angefordert (zusammen mit den Basis-Scopes) */
export const OAUTH_SCOPES_MIT_LESEZUGRIFF = [...OAUTH_SCOPES, GMAIL_READONLY_SCOPE];
