// Kennzeichnung der Mails in sent_messages.step

/**
 * Persönliche Antwort aus der Unibox (kein Kampagnenschritt). Zählt nicht gegen Kampagnen-/Tages-/Postfach-Limits und
 * nicht in der Analyse (Erstmail = 0, Follow-up n = n); sie wird nur protokolliert, damit der Verlauf nachvollziehbar bleibt.
 */
export const ANTWORT_STEP = -1;
