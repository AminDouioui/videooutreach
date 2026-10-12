// Reine Logik für Dateianhänge von Mails: erlaubte Typen, Dateinamen-Bereinigung, Prüfung der Dateikennung
// (Magic Bytes) und die Grenzen je Datei und je Mail. Keine DB- oder Dateisystemzugriffe.

export const MAX_DATEI_BYTES = 10 * 1024 * 1024;
export const MAX_GESAMT_BYTES = 15 * 1024 * 1024;
export const MAX_ANZAHL = 5;

type Kennung = 'pdf' | 'png' | 'jpg' | 'zip-office' | 'ole' | 'text';

/** Erlaubte Endungen mit MIME-Typ und der Kennung, die der Dateiinhalt haben muss. */
export const ERLAUBTE_TYPEN: Record<string, { mime: string; kennung: Kennung }> = {
  pdf: { mime: 'application/pdf', kennung: 'pdf' },
  doc: { mime: 'application/msword', kennung: 'ole' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kennung: 'zip-office' },
  xls: { mime: 'application/vnd.ms-excel', kennung: 'ole' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kennung: 'zip-office' },
  ppt: { mime: 'application/vnd.ms-powerpoint', kennung: 'ole' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kennung: 'zip-office' },
  csv: { mime: 'text/csv', kennung: 'text' },
  txt: { mime: 'text/plain', kennung: 'text' },
  png: { mime: 'image/png', kennung: 'png' },
  jpg: { mime: 'image/jpeg', kennung: 'jpg' },
  jpeg: { mime: 'image/jpeg', kennung: 'jpg' },
};

/** Für `<input accept>` im Upload-Feld */
export const ACCEPT = Object.keys(ERLAUBTE_TYPEN)
  .map((e) => `.${e}`)
  .join(',');

export const ERLAUBTE_ENDUNGEN_TEXT = Object.keys(ERLAUBTE_TYPEN).join(', ');

export const ZUSTELLBARKEIT_HINWEIS = 'Hinweis: Anhänge in Erstkontakt-Mails können die Zustellbarkeit verschlechtern (Spamfilter). Besser in Follow-ups oder als Link.';

export function formatGroesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}

/** Endung in Kleinbuchstaben ohne Punkt ('' wenn keine). */
export function endung(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * Bereinigt einen vom Browser gelieferten Dateinamen: nur der letzte Pfadteil, keine Steuerzeichen, keine
 * Pfad-/Anführungszeichen, höchstens 120 Zeichen (Endung bleibt erhalten). Umlaute bleiben erhalten.
 */
export function sanitiereDateiname(roh: string): string {
  let name = (roh ?? '').normalize('NFC');
  name = name.split(/[\\/]/).pop() ?? '';
  // Steuerzeichen, Anführungszeichen und Zeichen mit Sonderbedeutung in Dateinamen/Headern
  name = name.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩"<>:|?*;,%]/g, ' ');
  name = name.replace(/\s+/g, ' ').trim().replace(/^\.+/, '').trim();
  if (name.length > 120) {
    const e = endung(name);
    const suffix = e ? `.${e}` : '';
    name = name.slice(0, 120 - suffix.length).trim() + suffix;
  }
  return name || 'anhang';
}

/** Sicherer ASCII-Name für die Datei auf der Platte (Anzeigename steht in der DB). */
export function dateinameFuerPlatte(dateiname: string): string {
  const e = endung(dateiname);
  const basis = (e ? dateiname.slice(0, -(e.length + 1)) : dateiname).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
  const sauber = basis.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'datei';
  return e ? `${sauber}.${e}` : sauber;
}

function beginntMit(b: Buffer, bytes: number[]): boolean {
  return b.length >= bytes.length && bytes.every((v, i) => b[i] === v);
}

/** Passt der Inhalt zur Endung? Liefert null, wenn ja, sonst eine Fehlermeldung. */
function pruefeKennung(kennung: Kennung, inhalt: Buffer): string | null {
  switch (kennung) {
    case 'pdf':
      // Das Prüfmuster darf laut Spezifikation in den ersten 1024 Byte stehen
      return inhalt.subarray(0, 1024).includes('%PDF-') ? null : 'Der Inhalt ist keine gültige PDF-Datei';
    case 'png':
      return beginntMit(inhalt, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? null : 'Der Inhalt ist keine gültige PNG-Datei';
    case 'jpg':
      return beginntMit(inhalt, [0xff, 0xd8, 0xff]) ? null : 'Der Inhalt ist keine gültige JPEG-Datei';
    case 'zip-office':
      // Office-Open-XML = ZIP mit [Content_Types].xml (steht unkomprimiert in den Dateikopf-Einträgen)
      if (!beginntMit(inhalt, [0x50, 0x4b, 0x03, 0x04])) return 'Der Inhalt ist keine gültige Office-Datei (docx/xlsx/pptx)';
      return inhalt.includes('[Content_Types].xml') ? null : 'Der Inhalt ist keine gültige Office-Datei (docx/xlsx/pptx)';
    case 'ole':
      return beginntMit(inhalt, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) ? null : 'Der Inhalt ist keine gültige Office-Datei (doc/xls/ppt)';
    case 'text':
      // Kein Binärinhalt: keine NUL-Bytes in den ersten 8 KB
      return inhalt.subarray(0, 8192).includes(0) ? 'Der Inhalt ist keine Textdatei' : null;
  }
}

export type DateiPruefung = { ok: true; dateiname: string; mime: string } | { ok: false; fehler: string };

/** Prüft eine hochgeladene Datei: Endung, Größe, Dateikennung. Der Dateiname wird bereinigt zurückgegeben. */
export function pruefeDatei(name: string, inhalt: Buffer): DateiPruefung {
  const dateiname = sanitiereDateiname(name);
  const e = endung(dateiname);
  const typ = ERLAUBTE_TYPEN[e];
  if (!typ) return { ok: false, fehler: `Dateityp „${e ? `.${e}` : dateiname}“ ist nicht erlaubt (erlaubt: ${ERLAUBTE_ENDUNGEN_TEXT})` };
  if (inhalt.length === 0) return { ok: false, fehler: `„${dateiname}“ ist leer` };
  if (inhalt.length > MAX_DATEI_BYTES) return { ok: false, fehler: `„${dateiname}“ ist zu groß (${formatGroesse(inhalt.length)}, erlaubt sind ${formatGroesse(MAX_DATEI_BYTES)} je Datei)` };
  const kennung = pruefeKennung(typ.kennung, inhalt);
  if (kennung) return { ok: false, fehler: `„${dateiname}“: ${kennung}` };
  return { ok: true, dateiname, mime: typ.mime };
}

/** Prüft, ob zu den vorhandenen Anhängen eines Schritts noch eine Datei dieser Größe passt. Null = ok. */
export function pruefeGrenzen(vorhanden: { groesse: number }[], neueGroesse: number): string | null {
  if (vorhanden.length >= MAX_ANZAHL) return `Höchstens ${MAX_ANZAHL} Anhänge je Mail`;
  const summe = vorhanden.reduce((s, a) => s + a.groesse, 0);
  if (summe + neueGroesse > MAX_GESAMT_BYTES) return `Alle Anhänge einer Mail zusammen dürfen höchstens ${formatGroesse(MAX_GESAMT_BYTES)} groß sein (bisher ${formatGroesse(summe)})`;
  return null;
}
