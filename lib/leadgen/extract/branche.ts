import type { Branche } from './schemas';

// Branchenklassifikation: WZ-Code (WZ 2008) wo vorhanden, zusätzlich LLM-Klassifikation der Webseite (siehe schemas.ts / run.ts)

/** „25.73“, „2573“, „25.73.0“ → „25.73“; ungültig = null */
export function normalisiereWz(roh: string | null | undefined): string | null {
  const m = /^\s*(\d{2})\.?(\d{1,2})?(?:\.?\d)?\s*$/.exec(roh ?? '');
  if (!m) return null;
  return m[2] ? `${m[1]}.${m[2].padEnd(2, '0')}` : m[1];
}

/**
 * Ordnet einen WZ-Code unserer Taxonomie zu. Die WZ unterscheidet Formenbau nicht von Werkzeugbau (beides 25.73), deshalb
 * ist die Zuordnung nur eine Näherung und trägt eine niedrigere Konfidenz als eine belegte Webseiten-Klassifikation.
 */
export function wzZuBranche(wz: string | null | undefined): { branche: Branche; konfidenz: number } | null {
  const code = normalisiereWz(wz);
  if (!code) return null;
  const abteilung = Number(code.slice(0, 2));
  if (code === '25.73') return { branche: 'werkzeugbau', konfidenz: 0.6 };
  if (abteilung === 28) return { branche: 'maschinenbau', konfidenz: 0.7 };
  if (abteilung >= 10 && abteilung <= 33) return { branche: 'sonstige_fertigung', konfidenz: 0.7 };
  return { branche: 'keine_fertigung', konfidenz: 0.7 };
}
