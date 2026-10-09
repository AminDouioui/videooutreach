// Aufwärmrampe („slow ramp“): reine Funktion, damit sie später je Postfach genutzt werden kann

export type RampenEingabe = {
  /** Limit am ersten Tag */
  start: number;
  /** Steigerung pro Tag */
  schritt: number;
  /** Erster Versandtag 'YYYY-MM-DD'; null/ungültig = heute (also Tag 0) */
  beginn: string | null;
  /** Heutiges Datum 'YYYY-MM-DD' (Berlin) */
  heute: string;
  /** Obergrenze (normales Tageslimit) */
  max: number;
};

function tagNummer(datum: string | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum ?? '');
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** Vergangene Kalendertage zwischen `beginn` und `heute` (nie negativ). */
export function tageSeitBeginn(beginn: string | null, heute: string): number {
  const b = tagNummer(beginn);
  const h = tagNummer(heute);
  if (b === null || h === null) return 0;
  return Math.max(0, h - b);
}

/** Erlaubte Mails heute: min(max, start + schritt * Tage seit Beginn), mindestens 0. */
export function rampenLimit(e: RampenEingabe): number {
  const start = Math.max(0, Math.floor(e.start));
  const schritt = Math.max(0, Math.floor(e.schritt));
  const max = Math.max(0, Math.floor(e.max));
  return Math.min(max, start + schritt * tageSeitBeginn(e.beginn, e.heute));
}
