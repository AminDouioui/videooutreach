import { firmenSchluessel } from '@/lib/firma';
import type { Rechtsform } from '../types';

// Firmennamen: Rechtsform abtrennen und getrennt speichern, Schreibweise vereinheitlichen, `name_normalized` fürs Matching

const UND = '(?:&|\\+|und|u\\.)';

/** Reihenfolge wichtig: zusammengesetzte Formen vor den einfachen. Das Muster greift am Namensende. */
const FORMEN: Array<[Rechtsform, RegExp]> = [
  ['GmbH & Co. KGaA', new RegExp(`gmbh\\s*${UND}\\s*co\\.?\\s*kgaa`, 'i')],
  ['GmbH & Co. KG', new RegExp(`gmbh\\s*${UND}\\s*co\\.?\\s*kg`, 'i')],
  ['GmbH & Co. OHG', new RegExp(`gmbh\\s*${UND}\\s*co\\.?\\s*ohg`, 'i')],
  ['AG & Co. KG', new RegExp(`ag\\s*${UND}\\s*co\\.?\\s*kg`, 'i')],
  ['SE & Co. KG', new RegExp(`se\\s*${UND}\\s*co\\.?\\s*kg`, 'i')],
  ['UG (haftungsbeschränkt)', /ug\s*\(\s*haftungsbeschr(?:ä|ae)nkt\s*\)|ug\s+haftungsbeschr(?:ä|ae)nkt/i],
  ['gGmbH', /ggmbh/i],
  ['GmbH', /gmbh/i],
  ['mbH', /mbh/i],
  ['KGaA', /kgaa/i],
  ['AG', /ag/i],
  ['KG', /kg/i],
  ['OHG', /ohg/i],
  ['GbR', /gbr/i],
  ['UG', /ug/i],
  ['SE', /se/i],
  ['e.K.', /e\.\s?k\.?|e\.\s?kfm\.?|e\.\s?kffr\.?/i],
  ['eG', /e\.?\s?g\.?/i],
  ['e.V.', /e\.\s?v\.?/i],
  ['Ltd.', /ltd\.?/i],
  ['B.V.', /b\.\s?v\.?/i],
  ['Inc.', /inc\.?/i],
  ['LLC', /llc/i],
];

const ENDE = String.raw`\s*$`;
// Rechtsform steht am Ende, davor Leerzeichen, Komma oder Bindestrich (nicht mitten im Wort wie „Hamburg“)
const ANFANG = String.raw`(?:^|[\s,;-])`;

export type GetrennteFirma = { name: string; rechtsform: Rechtsform | null; nameNormalized: string };

/** Vereinheitlicht Leerraum und typografische Anführungszeichen, ohne die Schreibweise sonst anzutasten. */
export function bereinigeFirmenname(roh: string): string {
  return roh
    .replace(/[   ]/g, ' ')
    .replace(/[„“”‚‘’]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();
}

/**
 * Trennt die Rechtsform vom Namen („Müller Werkzeugbau GmbH & Co. KG“ → Name „Müller Werkzeugbau“, Form „GmbH & Co. KG“).
 * `nameNormalized` kommt aus lib/firma.ts (dieselbe Logik wie die Firmen-Dublettenprüfung im Import).
 */
export function trenneFirma(roh: string): GetrennteFirma {
  const bereinigt = bereinigeFirmenname(roh);
  for (const [form, muster] of FORMEN) {
    const treffer = new RegExp(`${ANFANG}(${muster.source})${ENDE}`, muster.flags).exec(bereinigt);
    if (!treffer) continue;
    // Der Treffer beginnt beim Trenner vor der Rechtsform; alles davor ist der Name
    const rest = bereinigt.slice(0, treffer.index).replace(/[\s,;-]+$/, '').trim();
    // Besteht der Name nur aus der Rechtsform („AG“), nichts abtrennen
    if (!rest) break;
    return { name: rest, rechtsform: form, nameNormalized: firmenSchluessel(rest) };
  }
  return { name: bereinigt, rechtsform: null, nameNormalized: firmenSchluessel(bereinigt) };
}
