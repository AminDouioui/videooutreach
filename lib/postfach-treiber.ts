import { istSmtp, kannAntwortenPruefen, kannThreadLesen } from './absender';
import { holeThreadRoh, pruefeThread, sendRaw, type GmailPostfach, type GmailSender, type ThreadLader, type ThreadPruefer } from './gmail';
import { smtpTreiber } from './smtp-treiber';

// Postfach-Treiber: eine Schnittstelle für alle Postfach-Typen. Versand, Antwort-Erkennung und Unibox rufen nie Gmail
// direkt auf, sondern den Treiber des Postfachs (typ 'gmail' = bisherige Gmail-Funktionen, 'smtp' = SMTP + IMAP).
// Die austauschbaren Typen GmailSender / ThreadPruefer / ThreadLader bleiben die Test-Schnittstelle der Aufrufer.

export type PostfachTyp = 'gmail' | 'smtp';

export type PostfachTreiber = {
  typ: PostfachTyp;
  /**
   * Sendet eine fertige base64url-MIME-Nachricht. Mit `threadId` als Antwort in diesem Thread (die Kopfzeilen
   * In-Reply-To/References stehen bereits in der Nachricht). Liefert Message-Kennung und Thread-ID.
   */
  senden: GmailSender;
  /** Prüft einen Thread auf Antwort / Bounce / Abwesenheitsnotiz (null = nichts Neues). Wirft GmailSendError. */
  pruefeThread: ThreadPruefer;
  /** Führt mehrere Prüfungen über eine einzige Verbindung aus (IMAP: eine Verbindung pro Durchlauf). */
  mitPruefsitzung<T>(postfach: GmailPostfach, fn: (pruefer: ThreadPruefer) => Promise<T>): Promise<T>;
  /** Liest einen Thread vollständig (Unibox). Wirft GmailSendError. */
  ladeThread: ThreadLader;
  /** Kann die Unibox Threads dieses Postfachs lesen? */
  kannLesen(postfach: GmailPostfach & { scopes?: string }): boolean;
  /** Kann die App Antworten auf eigene Mails erkennen (Voraussetzung für Follow-ups)? */
  kannAntwortenPruefen(postfach: GmailPostfach & { scopes?: string }): boolean;
};

const gmailTreiber: PostfachTreiber = {
  typ: 'gmail',
  senden: sendRaw,
  pruefeThread,
  mitPruefsitzung: (_postfach, fn) => fn(pruefeThread),
  ladeThread: holeThreadRoh,
  kannLesen: (p) => kannThreadLesen({ refreshTokenEnc: p.refreshTokenEnc, typ: p.typ, zugangsdatenEnc: p.zugangsdatenEnc, scopes: p.scopes ?? '' }),
  kannAntwortenPruefen: (p) => kannAntwortenPruefen({ refreshTokenEnc: p.refreshTokenEnc, typ: p.typ, zugangsdatenEnc: p.zugangsdatenEnc, scopes: p.scopes ?? '' }),
};

const standard: Record<PostfachTyp, PostfachTreiber> = { gmail: gmailTreiber, smtp: smtpTreiber };
const ersatz: Partial<Record<PostfachTyp, PostfachTreiber>> = {};

/** Treiber eines Postfachs (Bestand ohne Typ = Gmail). */
export function treiberFuer(postfach: Partial<Pick<GmailPostfach, 'typ'>>): PostfachTreiber {
  const typ: PostfachTyp = istSmtp(postfach) ? 'smtp' : 'gmail';
  return ersatz[typ] ?? standard[typ];
}

/** Nur für Tests: Treiber eines Typs ersetzen (null = Standard wiederherstellen). */
export function setzeTreiberFuerTests(typ: PostfachTyp, treiber: PostfachTreiber | null): void {
  if (treiber) ersatz[typ] = treiber;
  else delete ersatz[typ];
}
