// Spintax `{a|b|c}` – rein, deterministisch, ohne Abhängigkeiten.
//
// Regeln:
// - `{{…}}` (Platzhalter) wird nie als Spintax gelesen, auch nicht, wenn darin ein `|` (Fallback) steht.
// - Gruppen dürfen verschachtelt sein: `{Hallo|Guten {Tag|Morgen}}`.
// - Eine Gruppe ohne `|` auf oberster Ebene (`{x}`) bleibt wörtlich stehen (inkl. Klammern).
// - Die Auswahl hängt nur vom Seed und der laufenden Nummer der Gruppe ab (Vorschau = Versand).

/** FNV-1a (32 Bit) mit abschließendem Mischen, damit ähnliche Seeds gut streuen. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Index des schließenden `}` zur `{` an Position `start` (`{{…}}` zählt als Block), sonst -1. */
function findeEnde(s: string, start: number): number {
  let tiefe = 0;
  for (let i = start; i < s.length; i++) {
    if (s.startsWith('{{', i)) {
      const ende = s.indexOf('}}', i + 2);
      if (ende === -1) return -1;
      i = ende + 1;
    } else if (s[i] === '{') tiefe++;
    else if (s[i] === '}' && --tiefe === 0) return i;
  }
  return -1;
}

/** Teilt am `|` der obersten Ebene (verschachtelte Gruppen und `{{…}}` bleiben ganz). */
function teileOptionen(inhalt: string): string[] {
  const teile: string[] = [];
  let tiefe = 0;
  let von = 0;
  for (let i = 0; i < inhalt.length; i++) {
    if (inhalt.startsWith('{{', i)) {
      const ende = inhalt.indexOf('}}', i + 2);
      if (ende === -1) break;
      i = ende + 1;
    } else if (inhalt[i] === '{') tiefe++;
    else if (inhalt[i] === '}') tiefe--;
    else if (inhalt[i] === '|' && tiefe === 0) {
      teile.push(inhalt.slice(von, i));
      von = i + 1;
    }
  }
  teile.push(inhalt.slice(von));
  return teile;
}

/** Löst alle Spintax-Gruppen deterministisch anhand des Seeds auf. */
export function loeseSpintax(text: string, seed: string): string {
  let zaehler = 0;
  const lauf = (s: string): string => {
    let aus = '';
    let i = 0;
    while (i < s.length) {
      if (s.startsWith('{{', i)) {
        const ende = s.indexOf('}}', i + 2);
        const bis = ende === -1 ? s.length : ende + 2;
        aus += s.slice(i, bis);
        i = bis;
      } else if (s[i] === '{') {
        const ende = findeEnde(s, i);
        if (ende === -1) {
          aus += '{';
          i++;
          continue;
        }
        const inhalt = s.slice(i + 1, ende);
        const optionen = teileOptionen(inhalt);
        if (optionen.length < 2) {
          aus += `{${lauf(inhalt)}}`;
        } else {
          const wahl = hash32(`${seed}#${zaehler++}`) % optionen.length;
          aus += lauf(optionen[wahl]);
        }
        i = ende + 1;
      } else {
        aus += s[i];
        i++;
      }
    }
    return aus;
  };
  return lauf(text);
}

/**
 * Prüft die Klammern: jedes `{` braucht ein `}`, jedes `{{` ein `}}`, kein überzähliges `}`.
 * Liefert deutsche Fehlertexte (leer = in Ordnung).
 */
export function pruefeKlammern(text: string): string[] {
  const fehler: string[] = [];
  let tiefe = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('{{', i)) {
      const ende = text.indexOf('}}', i + 2);
      if (ende === -1) {
        fehler.push('Platzhalter „{{“ ohne schließendes „}}“');
        break;
      }
      i = ende + 1;
    } else if (text[i] === '{') tiefe++;
    else if (text[i] === '}') {
      if (tiefe === 0) {
        fehler.push('Überzählige schließende Klammer „}“');
        break;
      }
      tiefe--;
    }
  }
  if (tiefe > 0) fehler.push('Spintax-Klammer „{“ ohne schließendes „}“');
  return fehler;
}
