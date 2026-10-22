import type { NormalisiertePerson, PersonenRolle } from '../types';

// Personen: Vorname, Nachname, Titel und Rolle getrennt

/** Bestandteile akademischer Titel; ein Token gilt als Titel, wenn alle seine Teile (getrennt an „.“ und „-“) hier stehen. */
const TITEL_TEILE = new Set([
  'prof', 'dr', 'dipl', 'ing', 'mag', 'msc', 'bsc', 'ma', 'ba', 'mba', 'mult', 'hc', 'habil', 'rer', 'nat', 'jur', 'med', 'phil', 'pol', 'techn', 'oec',
  'kfm', 'kffr', 'wirtsch', 'inf', 'phys', 'math', 'chem', 'betriebsw', 'volksw', 'fh', 'ba', 'univ', 'eng', 'ing', 'lic',
]);

/** Namenszusätze, die zum Nachnamen gehören („von der Heide“) */
const NAMENSZUSATZ = new Set(['von', 'van', 'vom', 'der', 'den', 'de', 'di', 'da', 'zu', 'zur', 'zum', 'ten', 'ter', 'du', 'la', 'le', 'af', 'zu']);

function istTitel(token: string): boolean {
  const teile = token
    .toLowerCase()
    .replace(/[()]/g, '')
    .split(/[.\-/]+/)
    .filter(Boolean);
  return teile.length > 0 && teile.every((t) => TITEL_TEILE.has(t));
}

/** Rollenbezeichnung der Quelle auf unsere Rollen abbilden (Registertexte und Webseiten-Varianten). */
export function normalisiereRolle(roh: string | null | undefined): PersonenRolle {
  const s = (roh ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
  if (/gesch(ae)?ftsf(ue)?hr|managing director|\bceo\b|\bgf\b/.test(s)) return 'geschaeftsfuehrer';
  if (/vorstand|\bcfo\b|\bcoo\b/.test(s)) return 'vorstand';
  if (/prokur/.test(s)) return 'prokurist';
  if (/inhaber|einzelkaufmann|einzelkauffrau/.test(s)) return 'inhaber';
  if (/liquidator|abwickler/.test(s)) return 'liquidator';
  if (/gesellschafter|komplement(ae)?r|persoenlich haftend/.test(s)) return 'gesellschafter';
  return 'sonstige';
}

/**
 * Zerlegt einen Personennamen. Unterstützt „Dr. Hans Müller“, „Müller, Hans“, „Hans von der Heide“ und „Anna Schmidt-Meier“.
 * Ein einzelnes Wort gilt als Nachname. Leere Eingaben ergeben null.
 */
export function parsePerson(roh: string, rolleRoh?: string | null): NormalisiertePerson | null {
  const bereinigt = roh.replace(/\s+/g, ' ').trim();
  if (!bereinigt) return null;
  const titel: string[] = [];
  let vorname: string | null = null;
  let nachname: string;

  const komma = bereinigt.split(',').map((t) => t.trim()).filter(Boolean);
  // „Nachname, Vorname“ (Register): genau zwei Teile; ein Titel nach dem Komma („Müller, Dr.“) ist kein Vorname
  if (komma.length === 2 && !komma[1].split(' ').every(istTitel)) {
    const vornamenTokens: string[] = [];
    for (const t of komma[1].split(' ')) (istTitel(t) ? titel : vornamenTokens).push(t);
    const nachnamenTokens: string[] = [];
    for (const t of komma[0].split(' ')) (istTitel(t) ? titel : nachnamenTokens).push(t);
    vorname = vornamenTokens.join(' ') || null;
    nachname = nachnamenTokens.join(' ');
  } else {
    const tokens: string[] = [];
    for (const t of bereinigt.replace(/,/g, ' ').split(' ').filter(Boolean)) (istTitel(t) ? titel : tokens).push(t);
    if (tokens.length === 0) return null;
    // Nachname = letztes Wort plus davorstehende Namenszusätze („von der“)
    let start = tokens.length - 1;
    while (start > 0 && NAMENSZUSATZ.has(tokens[start - 1].toLowerCase())) start--;
    nachname = tokens.slice(start).join(' ');
    vorname = tokens.slice(0, start).join(' ') || null;
  }
  if (!nachname) return null;
  return { vorname, nachname, titel, rolle: normalisiereRolle(rolleRoh), rolleOriginal: rolleRoh?.trim() || null };
}
