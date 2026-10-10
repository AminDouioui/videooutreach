// Reine Logik der Follow-up-Varianten und der Antwort-Erkennung über mehrere Threads (ohne DB-/Node-Importe).

import type { ThreadErgebnis } from './gmail';
import { STANDARD_VARIANTE } from './varianten';

/** Variante eines Follow-up-Schritts, wie sie zum Senden gebraucht wird */
export type FollowupText = { kuerzel: string; body: string; betreff: string | null };

/**
 * Alle Threads eines Leads: zuerst der der Erstmail, danach die weiterer gesendeter Mails (Follow-ups mit eigenem
 * Betreff beginnen einen neuen Thread). Doppelte und leere IDs entfallen.
 */
export function alleThreadIds(erstThread: string | null | undefined, gesendet: (string | null | undefined)[]): string[] {
  const liste: string[] = [];
  for (const id of [erstThread, ...gesendet]) if (id && !liste.includes(id)) liste.push(id);
  return liste;
}

/** Rang eines Prüfergebnisses: eine echte Antwort entscheidet immer, dann Bounce, dann Abwesenheit. */
const RANG: Record<NonNullable<ThreadErgebnis>, number> = { antwort: 3, bounce: 2, abwesenheit: 1 };

/** Das „stärkere“ von zwei Ergebnissen (null = nichts erkannt). */
export function staerkeresErgebnis(a: ThreadErgebnis, b: ThreadErgebnis): ThreadErgebnis {
  return (a ? RANG[a] : 0) >= (b ? RANG[b] : 0) ? a : b;
}

/** Kürzel nutzen, bei fehlender Angabe (Altbestand) gilt A. */
export const kuerzelOderA = (k: string | null | undefined) => k || STANDARD_VARIANTE;
