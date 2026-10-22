import type { NormalisierteAdresse } from '../types';

// Adressen: Straße, PLZ, Ort und Bundesland getrennt

/**
 * Bundesland nach den ersten zwei Ziffern der PLZ. Nur eindeutige Bereiche; wo ein Bereich über Landesgrenzen läuft
 * (z. B. 21, 27, 32, 63, 88), bleibt der Eintrag leer, statt zu raten. Die Quelle (Register) hat immer Vorrang.
 */
const PLZ_BUNDESLAND: Record<string, string> = {
  '01': 'Sachsen', '02': 'Sachsen', '03': 'Brandenburg', '04': 'Sachsen', '06': 'Sachsen-Anhalt', '07': 'Thüringen', '08': 'Sachsen', '09': 'Sachsen',
  '10': 'Berlin', '12': 'Berlin', '13': 'Berlin', '15': 'Brandenburg', '16': 'Brandenburg', '17': 'Mecklenburg-Vorpommern', '18': 'Mecklenburg-Vorpommern',
  '20': 'Hamburg', '23': 'Schleswig-Holstein', '24': 'Schleswig-Holstein', '25': 'Schleswig-Holstein', '26': 'Niedersachsen', '28': 'Bremen', '29': 'Niedersachsen',
  '30': 'Niedersachsen', '31': 'Niedersachsen', '33': 'Nordrhein-Westfalen', '34': 'Hessen', '35': 'Hessen', '38': 'Niedersachsen', '39': 'Sachsen-Anhalt',
  '40': 'Nordrhein-Westfalen', '41': 'Nordrhein-Westfalen', '42': 'Nordrhein-Westfalen', '44': 'Nordrhein-Westfalen', '45': 'Nordrhein-Westfalen',
  '46': 'Nordrhein-Westfalen', '47': 'Nordrhein-Westfalen', '48': 'Nordrhein-Westfalen', '50': 'Nordrhein-Westfalen', '51': 'Nordrhein-Westfalen',
  '52': 'Nordrhein-Westfalen', '53': 'Nordrhein-Westfalen', '54': 'Rheinland-Pfalz', '55': 'Rheinland-Pfalz', '56': 'Rheinland-Pfalz', '58': 'Nordrhein-Westfalen',
  '59': 'Nordrhein-Westfalen', '60': 'Hessen', '61': 'Hessen', '64': 'Hessen', '66': 'Saarland', '67': 'Rheinland-Pfalz', '68': 'Baden-Württemberg',
  '69': 'Baden-Württemberg', '70': 'Baden-Württemberg', '71': 'Baden-Württemberg', '72': 'Baden-Württemberg', '73': 'Baden-Württemberg',
  '74': 'Baden-Württemberg', '75': 'Baden-Württemberg', '76': 'Baden-Württemberg', '77': 'Baden-Württemberg', '78': 'Baden-Württemberg',
  '79': 'Baden-Württemberg', '80': 'Bayern', '81': 'Bayern', '82': 'Bayern', '83': 'Bayern', '84': 'Bayern', '85': 'Bayern', '86': 'Bayern', '87': 'Bayern',
  '90': 'Bayern', '91': 'Bayern', '92': 'Bayern', '93': 'Bayern', '94': 'Bayern', '95': 'Bayern', '96': 'Bayern', '97': 'Bayern', '98': 'Thüringen', '99': 'Thüringen',
};

export const BUNDESLAENDER = [
  'Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen', 'Mecklenburg-Vorpommern', 'Niedersachsen',
  'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Saarland', 'Sachsen', 'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen',
] as const;

/** Bundesland aus der PLZ oder null, wenn der Bereich nicht eindeutig ist. */
export function bundeslandVonPlz(plz: string | null | undefined): string | null {
  if (!plz || !/^\d{5}$/.test(plz)) return null;
  return PLZ_BUNDESLAND[plz.slice(0, 2)] ?? null;
}

/** Bundesland-Schreibweisen der Quellen („Baden-Wuerttemberg“, „NRW“ …) auf die amtliche Form bringen; unbekannt = null. */
export function normalisiereBundesland(roh: string | null | undefined): string | null {
  if (!roh) return null;
  const s = roh
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z]+/g, '');
  const tabelle: Record<string, string> = { nrw: 'Nordrhein-Westfalen', bw: 'Baden-Württemberg', by: 'Bayern', rp: 'Rheinland-Pfalz', sh: 'Schleswig-Holstein', mv: 'Mecklenburg-Vorpommern', nds: 'Niedersachsen', st: 'Sachsen-Anhalt', th: 'Thüringen' };
  if (tabelle[s]) return tabelle[s];
  return BUNDESLAENDER.find((b) => b.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z]+/g, '') === s) ?? null;
}

/** Straßenschreibweise vereinheitlichen („Hauptstr. 5“, „Hauptstrasse 5“ → „Hauptstraße 5“) für den Adressvergleich. */
export function normalisiereStrasse(roh: string): string {
  return roh
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(S|s)tr\.(?=\s|\d|$)/g, (_, c: string) => `${c}traße`)
    .replace(/(S|s)trasse\b/g, (_, c: string) => `${c}traße`);
}

/**
 * Zerlegt eine Adresse wie „Musterstraße 5, 70173 Stuttgart“ (auch mehrzeilig oder mit Land am Ende).
 * Die PLZ ist der Anker: davor steht die Straße, danach der Ort. Bundesland: `bundeslandQuelle` hat Vorrang, sonst aus der PLZ.
 */
export function parseAdresse(roh: string | null | undefined, bundeslandQuelle?: string | null): NormalisierteAdresse | null {
  if (!roh || !roh.trim()) return null;
  const text = roh.replace(/\r?\n/g, ', ').replace(/\s+/g, ' ').replace(/,?\s*(?:Deutschland|Germany|DE)\s*$/i, '').trim();
  const m = /(?:^|[\s,])(?:D-)?(\d{5})\s+([^,\d][^,]*)/.exec(text);
  let strasse: string | null = null;
  let plz: string | null = null;
  let ort: string | null = null;
  if (m) {
    plz = m[1];
    ort = m[2].trim();
    const davor = text.slice(0, m.index).replace(/[,\s]+$/, '').trim();
    strasse = davor ? normalisiereStrasse(davor) : null;
  } else {
    strasse = normalisiereStrasse(text);
  }
  const quelle = normalisiereBundesland(bundeslandQuelle);
  const ausPlz = bundeslandVonPlz(plz);
  const bundesland = quelle ?? ausPlz;
  return { strasse, plz, ort, bundesland, bundeslandHerkunft: quelle ? 'quelle' : ausPlz ? 'plz' : null };
}
