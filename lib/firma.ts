// Firmen-Duplikate erkennen: Schreibweisen und Rechtsformen vereinheitlichen

// Rechtsformen, die für den Vergleich keine Rolle spielen (als ganze Wörter, nach Umlaut-Ersetzung)
const RECHTSFORMEN = [
  'gmbh & co kgaa',
  'gmbh & co kg',
  'gmbh & co ohg',
  'ag & co kg',
  'se & co kg',
  'ug haftungsbeschraenkt',
  'mbh',
  'gmbh',
  'ggmbh',
  'kgaa',
  'ag',
  'kg',
  'ohg',
  'gbr',
  'ug',
  'se',
  'ek',
  'ev',
  'eg',
  'ltd',
  'llc',
  'inc',
  'bv',
  'sarl',
  'sa',
  'srl',
  'spa',
];

/**
 * Normalisierter Firmenschlüssel für den Duplikat-Vergleich:
 * Kleinschreibung, Umlaute ausgeschrieben, Satzzeichen weg, Rechtsform am Ende entfernt.
 * „Müller GmbH & Co. KG“, „mueller gmbh“ und „Müller“ ergeben denselben Schlüssel.
 */
export function firmenSchluessel(firma: string): string {
  let s = firma
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\+/g, ' & ')
    .replace(/\bund\b/g, ' & ')
    .replace(/[^a-z0-9&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Rechtsformen am Ende (auch mehrfach, z. B. „… GmbH & Co. KG“) abschneiden
  let geaendert = true;
  while (geaendert) {
    geaendert = false;
    for (const r of RECHTSFORMEN) {
      if (s.endsWith(` ${r}`)) {
        s = s.slice(0, -r.length - 1).trim();
        geaendert = true;
      }
    }
  }
  return s.replace(/\s*&\s*$/, '').trim() || firma.trim().toLowerCase();
}

/**
 * Ids der Firmen-Duplikate: je Firma bleibt der erste Eintrag (Reihenfolge der Eingabe), alle weiteren sind Duplikate.
 */
export function firmenDuplikate<T extends { id: number; firma: string }>(eintraege: T[]): Set<number> {
  const gesehen = new Set<string>();
  const duplikate = new Set<number>();
  for (const e of eintraege) {
    const k = firmenSchluessel(e.firma);
    if (gesehen.has(k)) duplikate.add(e.id);
    else gesehen.add(k);
  }
  return duplikate;
}
