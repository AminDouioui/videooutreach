import { normalisiereText } from '../resolve/match';

// Namensvarianten für die Bildung von E-Mail-Adressen: Umlaute (ä → ae und a, ß → ss und s), Doppelnamen, Bindestrich-Namen,
// Namenszusätze (von, van). Die erste Variante ist jeweils die wahrscheinlichste.

const ZUSATZ = new Set(['von', 'van', 'vom', 'der', 'den', 'de', 'di', 'da', 'zu', 'zur', 'zum', 'ten', 'ter', 'du', 'la', 'le', 'af']);

/** „müller“ → ['mueller', 'muller']: Umlaute einmal ausgeschrieben und einmal vereinfacht; Akzente weg, Sonderzeichen entfernt. */
export function falteVarianten(s: string): string[] {
  const basis = s.toLowerCase().replace(/['’`´.]/g, '');
  const ausgeschrieben = basis.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  const vereinfacht = basis.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 's');
  const aufraeumen = (x: string) =>
    x
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\- ]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  return [...new Set([aufraeumen(ausgeschrieben), aufraeumen(vereinfacht)])].filter(Boolean);
}

export type NamensVarianten = { vornamen: string[]; nachnamen: string[]; initialen: string[] };

function ohneDuplikate(liste: string[]): string[] {
  return [...new Set(liste.filter(Boolean))];
}

/** Varianten eines Nachnamens (je Umlaut-Variante bereits gefaltet übergeben): Bindestrich-Namen, Zusätze, Teile. */
function nachnamenVarianten(gefaltet: string): string[] {
  const tokens = gefaltet.split(/[ ]+/).filter(Boolean);
  const ohneZusatz = tokens.filter((t) => !ZUSATZ.has(t));
  const hauptTeil = ohneZusatz.join(' ') || tokens.join(' ');
  const teile = hauptTeil.split(/[- ]+/).filter(Boolean);
  const varianten: string[] = [];
  if (hauptTeil.includes('-') || teile.length > 1) {
    // Doppelname: mit Bindestrich, zusammengeschrieben, nur der erste und nur der letzte Teil
    varianten.push(teile.join('-'), teile.join(''), teile[0], teile[teile.length - 1]);
  } else {
    varianten.push(hauptTeil);
  }
  // Mit Zusatz („vonderheide“), nachrangig hinter der Variante ohne Zusatz
  if (tokens.length > ohneZusatz.length) varianten.push(tokens.join(''));
  return ohneDuplikate(varianten);
}

function vornamenVarianten(gefaltet: string): string[] {
  const teile = gefaltet.split(/[- ]+/).filter(Boolean);
  if (!teile.length) return [];
  const varianten = [teile[0]];
  if (teile.length > 1) varianten.push(teile.join(''), teile.join('-'));
  return ohneDuplikate(varianten);
}

/** Alle Varianten, aus denen E-Mail-Lokalteile gebaut werden. Die Reihenfolge steht für die Wahrscheinlichkeit. */
export function namensVarianten(p: { vorname: string | null; nachname: string }): NamensVarianten {
  const nachnamen: string[] = [];
  for (const f of falteVarianten(p.nachname)) nachnamen.push(...nachnamenVarianten(f));
  const vornamen: string[] = [];
  const initialen: string[] = [];
  for (const f of falteVarianten(p.vorname ?? '')) {
    vornamen.push(...vornamenVarianten(f));
    const teile = f.split(/[- ]+/).filter(Boolean);
    if (teile[0]) initialen.push(teile[0][0]);
    // Doppelvorname „Hans-Peter“ → auch „hp“
    if (teile.length > 1) initialen.push(teile.map((t) => t[0]).join(''));
  }
  return { vornamen: ohneDuplikate(vornamen), nachnamen: ohneDuplikate(nachnamen), initialen: ohneDuplikate(initialen) };
}

/** Normalisierter Vergleichswert („Müller“ == „Mueller“) */
export function namensSchluessel(s: string): string {
  return normalisiereText(s).replace(/ /g, '');
}
