// Registernummer und Registergericht aus Registertexten lesen („Amtsgericht Stuttgart HRB 12345“, „Stuttgart HRB 12345 B“)

export type Registerangabe = { art: string | null; nummer: string | null; gericht: string | null };

const ARTEN = 'HRB|HRA|GnR|PR|VR';

/**
 * Liest Registerart, -nummer und Gericht. Die Nummer wird ohne Leerzeichen-Varianten gespeichert („HRB 12345“, Zusatzbuchstaben
 * wie „B“ in „HRB 12345 B“ bleiben getrennt weg, weil sie nur den Registerbezirk Berlin/Hamburg betreffen und den Treffer nicht ändern).
 * Fehlende Teile ergeben null, es wird nie geraten.
 */
export function parseRegister(roh: string | null | undefined): Registerangabe {
  if (!roh) return { art: null, nummer: null, gericht: null };
  const text = roh.replace(/\s+/g, ' ').trim();
  const nr = new RegExp(`\\b(${ARTEN})\\s*(\\d{1,7})(?:\\s?[A-Z])?\\b`, 'i').exec(text);
  const gericht = /(?:Amtsgericht|AG)\s+([A-ZÄÖÜ][\wäöüÄÖÜß.-]*(?: (?!Handelsregister|Registernummer|Registergericht|HR[AB]\b|GnR\b|PR\b|VR\b)[A-ZÄÖÜ][\wäöüÄÖÜß.-]*){0,2})/.exec(text)?.[1]?.trim() ?? gerichtVorNummer(text, nr?.index);
  return { art: nr ? nr[1].toUpperCase().replace('GNR', 'GnR') : null, nummer: nr ? nr[2] : null, gericht: gericht ?? null };
}

/** „Stuttgart HRB 12345“: steht ohne „Amtsgericht“ ein Ortsname direkt vor der Registerart, ist das das Gericht. */
function gerichtVorNummer(text: string, index: number | undefined): string | null {
  if (index === undefined || index === 0) return null;
  const davor = text.slice(0, index).replace(/[\s,:-]+$/, '').trim();
  return /^[A-ZÄÖÜ][\wäöüÄÖÜß.\- ]{1,40}$/.test(davor) ? davor : null;
}

/** Stabiler Schlüssel für den harten Match der Entity Resolution: „stuttgart|HRB|12345“; null, wenn eine Angabe fehlt. */
export function registerSchluessel(r: Registerangabe): string | null {
  if (!r.art || !r.nummer || !r.gericht) return null;
  const gericht = r.gericht
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${gericht}|${r.art.toUpperCase()}|${r.nummer}`;
}
