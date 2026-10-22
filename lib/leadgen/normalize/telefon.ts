import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

// Telefonnummern: E.164 und Typ (Mobil, Festnetz)

export type TelefonTyp = 'mobil' | 'festnetz' | 'sonstige' | 'unbekannt';

export type NormalisiertesTelefon = {
  e164: string;
  /** Lesbare nationale Form, z. B. „0711 1234567“ */
  national: string;
  typ: TelefonTyp;
  land: string | null;
};

/** Normalisiert eine Rufnummer (ohne Landesvorwahl gilt Deutschland); ungültige Nummern ergeben null. */
export function normalisiereTelefon(roh: string, standardLand: 'DE' | 'AT' | 'CH' = 'DE'): NormalisiertesTelefon | null {
  // Klammerzusätze wie „(0)“ in „+49 (0) 711 …“ stören die Auswertung
  const text = roh.replace(/\(\s*0\s*\)/g, '').replace(/^\s*(?:tel(?:efon)?|fon|mobil|handy|fax)[.:\s]+/i, '').trim();
  const nr = parsePhoneNumberFromString(text, standardLand);
  if (!nr || !nr.isValid()) return null;
  const art = nr.getType();
  const typ: TelefonTyp = art === 'MOBILE' ? 'mobil' : art === 'FIXED_LINE' ? 'festnetz' : art === undefined || art === 'FIXED_LINE_OR_MOBILE' ? 'unbekannt' : 'sonstige';
  return { e164: nr.number, national: nr.formatNational(), typ, land: nr.country ?? null };
}
