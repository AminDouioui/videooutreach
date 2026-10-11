import { bewerteNachrichten, klassifiziereNachricht, type Kopfzeilen, type NachrichtenArt } from './autoreply';
import { extrahiereAdresse } from './mail-parse';


// Zuordnung von IMAP-Nachrichten zu einem Lead (SMTP-Postfächer). Rein, ohne Netz: Eingabe sind die Kopfzeilen der
// Kandidaten, die der IMAP-Server geliefert hat; die Entscheidung, was wirklich zum Lead gehört, fällt hier – der
// Server-Suche wird nicht vertraut (andere Leads teilen sich dasselbe Postfach).

/** Eine Kandidaten-Nachricht aus dem Posteingang */
export type ImapKandidat = {
  /** Kopfzeilen, Namen klein */
  kopf: Kopfzeilen;
  /** Zeitpunkt (Unix-ms, INTERNALDATE bzw. Date-Header); null = unbekannt */
  datum: number | null;
  /** Anfang der Rohnachricht (für Bounces: enthält die Message-ID der abgewiesenen Mail) */
  textauszug?: string;
};

export type ZuordnungsKontext = {
  /** Adresse des eigenen Postfachs (eigene Nachrichten zählen nie) */
  eigeneAdresse: string;
  /** Message-IDs unserer gesendeten Mails an den Lead (mit oder ohne <>) */
  messageIds: string[];
  /** Adresse des Leads: Mails von ihr nach `seit` zählen auch ohne Bezug als Antwort */
  leadAdresse?: string | null;
  /** Zeitpunkt der Erstmail (Unix-ms) */
  seit?: number | null;
};

/** Message-ID ohne <> in Kleinschreibung. */
export function normalisiereMessageId(id: string): string {
  return id.trim().replace(/^<|>$/g, '').trim().toLowerCase();
}

/** Alle Message-IDs aus einem In-Reply-To-/References-Wert. */
export function messageIdsAus(wert: string | undefined): string[] {
  const treffer = (wert ?? '').match(/<[^<>\s]+>/g) ?? [];
  return treffer.map(normalisiereMessageId);
}

/** Thread-ID eines SMTP-Postfachs ist `smtp:<Message-ID der Erstmail>`. */
export const SMTP_THREAD_PREFIX = 'smtp:';

export function istSmtpThread(threadId: string | null | undefined): boolean {
  return !!threadId && threadId.startsWith(SMTP_THREAD_PREFIX);
}

export function smtpThreadId(messageId: string): string {
  return `${SMTP_THREAD_PREFIX}${messageId}`;
}

/** Message-ID aus einer SMTP-Thread-ID (ohne Präfix). */
export function messageIdAusThread(threadId: string): string {
  return istSmtpThread(threadId) ? threadId.slice(SMTP_THREAD_PREFIX.length) : threadId;
}

/** multipart/report mit report-type=delivery-status (RFC 3464): Zustellbericht, auch wenn der Absender nicht mailer-daemon heißt. */
export function istZustellbericht(kopf: Kopfzeilen): boolean {
  const ct = kopf['content-type'] ?? '';
  return /multipart\/report/i.test(ct) && /report-type\s*=\s*"?delivery-status/i.test(ct);
}

/** Tolerierte Abweichung zwischen Erstmail-Zeitpunkt und Datum einer Antwort (Uhren/Zeitzonen) */
const TOLERANZ_MS = 60_000;

/**
 * Bewertet die Kandidaten für einen Lead:
 * - Bezug: In-Reply-To/References enthält eine unserer Message-IDs → gehört zum Thread
 * - Lead-Adresse: Absender ist der Lead und das Datum liegt nach der Erstmail → zählt auch ohne Bezug
 * - Bounce: Zustellbericht (mailer-daemon/postmaster/Betreff) zählt nur, wenn unsere Message-ID in den Kopfzeilen oder im
 *   Textauszug steht – ein Bounce für einen anderen Lead darf diesen nicht stoppen
 * Eigene Nachrichten werden übersprungen. Abwesenheit/Antwort/Bounce unterscheidet lib/autoreply.ts; eine echte
 * Antwort entscheidet immer.
 */
export function ordneNachrichtenZu(kandidaten: ImapKandidat[], k: ZuordnungsKontext): NachrichtenArt | null {
  const eigen = k.eigeneAdresse.trim().toLowerCase();
  const ids = new Set(k.messageIds.map(normalisiereMessageId).filter(Boolean));
  const lead = (k.leadAdresse ?? '').trim().toLowerCase();
  const arten: NachrichtenArt[] = [];

  for (const n of kandidaten) {
    const von = (n.kopf['from'] ?? '').toLowerCase();
    if (!von) continue;
    const vonAdresse = extrahiereAdresse(von);
    if (eigen && vonAdresse === eigen) continue;

    const bezug = [...messageIdsAus(n.kopf['in-reply-to']), ...messageIdsAus(n.kopf['references'])].some((id) => ids.has(id));
    const vomLead = !!lead && vonAdresse === lead && (k.seit == null || n.datum == null || n.datum >= k.seit - TOLERANZ_MS);
    const art = istZustellbericht(n.kopf) ? 'bounce' : klassifiziereNachricht(n.kopf);

    if (art === 'bounce') {
      // Bounce nur, wenn er unsere Mail meint: Bezug oder Message-ID im Kopf bzw. Text des Berichts
      const alles = `${Object.values(n.kopf).join('\n')}\n${n.textauszug ?? ''}`.toLowerCase();
      const nennt = [...ids].some((id) => alles.includes(id));
      if (bezug || nennt) arten.push('bounce');
      continue;
    }
    if (bezug || vomLead) arten.push(art);
  }
  return bewerteNachrichten(arten);
}

/** Alle reinen Adressen (klein) aus einer Adressliste wie „Name <a@b.de>, c@d.de“. */
export function imapAdressen(liste: string): string[] {
  const aus: string[] = [];
  // Anführungszeichen-Namen können Kommas enthalten: erst entfernen
  const ohneNamen = liste.replace(/"(?:[^"\\]|\\.)*"/g, '');
  for (const teil of ohneNamen.split(/[,;]/)) {
    const a = extrahiereAdresse(teil);
    if (a && !aus.includes(a)) aus.push(a);
  }
  return aus;
}
