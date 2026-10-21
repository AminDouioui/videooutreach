// A/B-Automatik (rein, ohne DB): schaltet Erstmail-Varianten ab, die nach genug Versand deutlich schlechter antworten
// als die beste. „Deutlich“ heißt statistisch: die obere Grenze des Wilson-Intervalls der schwachen Variante liegt unter
// der unteren Grenze der besten (90 % Sicherheit). Variante A (die Kampagnen-Vorlage) bleibt immer aktiv, wird aber gemeldet.

/** So viele gesendete Erstmails braucht eine Variante, bevor sie bewertet wird */
export const AB_MIN_GESENDET = 40;
const Z = 1.645;

export function wilson(n: number, k: number, z = Z): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 1 };
  const p = k / n;
  const nenner = 1 + (z * z) / n;
  const mitte = (p + (z * z) / (2 * n)) / nenner;
  const halb = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / nenner;
  return { low: Math.max(0, mitte - halb), high: Math.min(1, mitte + halb) };
}

export type AbZeile = { kuerzel: string; aktiv: boolean; gesendet: number; antworten: number };
export type AbEntscheidung = { kuerzel: string; grund: string };
export type AbBewertung = { fuehrend: string | null; abschalten: AbEntscheidung[]; aUnterlegen: AbEntscheidung | null };

const pct = (n: number, k: number) => `${((k / n) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;

export function bewerteVarianten(zeilen: AbZeile[], minGesendet = AB_MIN_GESENDET): AbBewertung {
  const bewertbar = zeilen.filter((z) => z.gesendet >= minGesendet && (z.aktiv || z.kuerzel === 'A'));
  if (bewertbar.length < 2) return { fuehrend: null, abschalten: [], aUnterlegen: null };
  const beste = bewertbar.reduce((b, z) => (z.antworten / z.gesendet > b.antworten / b.gesendet ? z : b));
  const bestUnten = wilson(beste.gesendet, beste.antworten).low;
  const entscheidungen: AbEntscheidung[] = [];
  let aUnterlegen: AbEntscheidung | null = null;
  for (const z of bewertbar) {
    if (z.kuerzel === beste.kuerzel) continue;
    if (wilson(z.gesendet, z.antworten).high < bestUnten) {
      const grund = `Antwortrate ${pct(z.gesendet, z.antworten)} bei ${z.gesendet} Mails, deutlich unter Variante ${beste.kuerzel} mit ${pct(beste.gesendet, beste.antworten)} bei ${beste.gesendet} Mails`;
      if (z.kuerzel === 'A') aUnterlegen = { kuerzel: 'A', grund };
      else entscheidungen.push({ kuerzel: z.kuerzel, grund });
    }
  }
  return { fuehrend: beste.kuerzel, abschalten: entscheidungen, aUnterlegen };
}
