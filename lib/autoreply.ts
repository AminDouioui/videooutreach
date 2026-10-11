// Erkennung von Bounces, Abwesenheitsnotizen und echten Antworten anhand der Kopfzeilen einer fremden Nachricht
// (rein, ohne DB und Gmail). Es werden nur Header ausgewertet – Inhalte der Mails werden nie gelesen.

export type NachrichtenArt = 'bounce' | 'abwesenheit' | 'antwort';

/** Kopfzeilen einer Nachricht, Namen in Kleinbuchstaben */
export type Kopfzeilen = Record<string, string>;

const BOUNCE_ABSENDER = /mailer-daemon|postmaster/i;
// Zustellberichte, die nicht von mailer-daemon/postmaster kommen (Betreff beginnt damit, ggf. nach „Re:“ nicht)
const BOUNCE_BETREFF = /^\s*(delivery status notification|undeliverable|undelivered mail|mail delivery (failed|subsystem)|returned mail|failure notice|nicht zustellbar|zustellung fehlgeschlagen|unzustellbar)/;

// Betreff-Muster für Abwesenheitsnotizen (de/en/fr/es/it/nl), nach Kleinschreibung und ohne Akzente/Umlaute geprüft
const ABWESENHEIT_BETREFF: RegExp[] = [
  // de
  /\babwesen(d|heit)/,
  /\bautomatische[rn]? (antwort|nachricht|rueckmeldung|abwesenheit)/,
  /\bautoantwort/,
  /\bnicht im (buero|haus)\b/,
  /\burlaubs(benachrichtigung|nachricht|antwort)/,
  // en
  /\bout of (the )?office\b/,
  /\bauto(matic)?[ -]?(reply|response|responder)\b/,
  /\baway from (the |my )?(office|desk)\b/,
  /\bvacation (auto|reply|response|message)/,
  /\boff(ice)? (closed|absence)\b/,
  // fr
  /\breponse automatique\b/,
  /\bmessage d'?absence\b/,
  /\babsent(e)? du bureau\b/,
  /\bhors du bureau\b/,
  /\babsence du bureau\b/,
  // es
  /\bfuera de (la )?oficina\b/,
  /\brespuesta automatica\b/,
  /\bmensaje automatico\b/,
  /\bausente\b/,
  // it
  /\brisposta automatica\b/,
  /\bfuori (sede|ufficio)\b/,
  /\bmessaggio di assenza\b/,
  /\bassente dall'?ufficio\b/,
  // nl
  /\bautomatisch (antwoord|bericht)\b/,
  /\bafwezig(heid|heidsmelding)?\b/,
  /\bbuiten kantoor\b/,
];

/** Kleinschreibung, Umlaute/Akzente entfernt (ä → a, ß → ss, é → e) */
function normalisiere(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/’/g, "'");
}

export function istBounce(h: Kopfzeilen): boolean {
  if (BOUNCE_ABSENDER.test(h['from'] ?? '')) return true;
  return BOUNCE_BETREFF.test(normalisiere(h['subject'] ?? ''));
}

/** Passt der Betreff zu einer automatischen Antwort? */
export function betreffIstAbwesenheit(betreff: string): boolean {
  const b = normalisiere(betreff);
  return b !== '' && ABWESENHEIT_BETREFF.some((r) => r.test(b));
}

/**
 * Ist die Nachricht eine automatische Antwort? Starke Hinweise genügen allein: Auto-Submitted (≠ „no“, RFC 3834),
 * X-Autoreply, X-Autorespond, Precedence auto_reply/bulk/junk. X-Auto-Response-Suppress ist nur ein Indiz (setzt auch
 * Exchange bei normalen Mails) und zählt nur zusammen mit passendem Betreff. Der Betreff allein genügt ebenfalls.
 */
export function istAbwesenheit(h: Kopfzeilen): boolean {
  const auto = (h['auto-submitted'] ?? '').trim().toLowerCase();
  if (auto !== '' && auto !== 'no') return true;
  if ((h['x-autoreply'] ?? '').trim() !== '' || (h['x-autorespond'] ?? '').trim() !== '') return true;
  const vorrang = (h['precedence'] ?? '').trim().toLowerCase().replace(/[-\s]/g, '_');
  if (vorrang === 'auto_reply' || vorrang === 'bulk' || vorrang === 'junk') return true;
  // X-Auto-Response-Suppress ist nur ein Indiz: es verstärkt den Betreff, ersetzt ihn aber nicht
  return betreffIstAbwesenheit(h['subject'] ?? '');
}

/** Ordnet eine fremde Nachricht ein. Bounces haben Vorrang vor Abwesenheitsnotizen (Zustellberichte tragen oft Auto-Submitted). */
export function klassifiziereNachricht(h: Kopfzeilen): NachrichtenArt {
  if (istBounce(h)) return 'bounce';
  if (istAbwesenheit(h)) return 'abwesenheit';
  return 'antwort';
}

/**
 * Bewertet die fremden Nachrichten eines Threads (chronologisch). Irgendeine echte Antwort entscheidet immer
 * („antwort“, auch nach einer Abwesenheitsnotiz); sonst gilt die neueste fremde Nachricht (Bounce bzw. Abwesenheit).
 */
export function bewerteNachrichten(arten: NachrichtenArt[]): NachrichtenArt | null {
  if (arten.includes('antwort')) return 'antwort';
  return arten.length > 0 ? arten[arten.length - 1] : null;
}
