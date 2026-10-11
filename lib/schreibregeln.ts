// Prozessia-Schreibregeln (aus dem Brain übernommen: lead-agent/gmail_client.py::style_violations und CLAUDE.md).
// Rein und ohne Node-Importe, daher auch im Browser (Editoren, Unibox) nutzbar.
//
// Regeln:
// - keine Gedankenstriche (– —),
// - keine Bindestriche als Trenner ( - ),
// - keine runden Klammern ( ). Bindestriche in zusammengesetzten Wörtern (E-Mail, KI-gestützt) sind erlaubt.
// - Wahrheitsregel: kein Text darf ein Gespräch behaupten, das nicht stattfand („unser Telefonat“, „wie besprochen“ …).
// Platzhalter {{…}}, Spintax {a|b} und URLs zählen nicht als Klammern bzw. Trenner: sie werden vor der Prüfung
// durch gleich lange Füllzeichen ersetzt, damit die Fundstellen im Originaltext stimmen.

export type SchreibRegel = 'gedankenstrich' | 'trenner' | 'klammern' | 'gespraech';

export type SchreibVerstoss = {
  regel: SchreibRegel;
  label: string;
  /** Ausschnitt um die Fundstelle (Zeilenumbrüche als Leerzeichen) */
  stelle: string;
  /** Der Treffer selbst, Position im Ausschnitt `stelle` (für die Markierung) */
  markVon: number;
  markBis: number;
  /** Position im geprüften Text */
  von: number;
  bis: number;
};

const REGELN: { regel: SchreibRegel; label: string; muster: RegExp }[] = [
  { regel: 'gedankenstrich', label: 'Gedankenstrich (– —)', muster: /[–—―−]/g },
  { regel: 'trenner', label: 'Bindestrich als Trenner ( - )', muster: /\s-\s/g },
  { regel: 'klammern', label: 'Klammern', muster: /[()]/g },
];

/** Aussagen, die ein Gespräch mit dem Empfänger behaupten (wie call_followup.direct_claims im Brain, plus „wie telefonisch besprochen“). */
const GESPRAECH: { label: string; muster: RegExp }[] = [
  { label: 'unser Telefonat/Gespräch', muster: /\bunser(?:e|em|en|er|es)?\s+(?:\p{L}+\s+)?(?:Telefonat|Gespräch|Austausch)\b/giu },
  { label: 'Dank für das Gespräch', muster: /\bDank\p{L}*\s+(?:Ihnen\s+)?für\s+(?:das|unser|Ihre|die)\s+(?:\p{L}+\s+)?(?:Gespräch|Telefonat|Austausch)/giu },
  { label: 'wie besprochen', muster: /\bwie\s+(?:telefonisch\s+)?(?:besprochen|vereinbart)\b|\bwie\s+telefonisch\b/giu },
  { label: 'mit Ihnen telefoniert/gesprochen', muster: /\bmit\s+(?:Ihnen|Ihrer|Ihrem)\b[^.\n]{0,80}\b(?:telefoniert|gesprochen)/giu },
  { label: 'Telefonat mit Ihnen', muster: /\bTelefonat\s+(?:mit\s+Ihnen|eben|heute)\b/giu },
];

const URL_MUSTER = /https?:\/\/[^\s<>"]+/gi;
const PLATZHALTER_MUSTER = /\{\{[^{}]*\}\}/g;

function fuelle(treffer: string): string {
  return 'x'.repeat(treffer.length);
}

/** Ersetzt Platzhalter und URLs durch gleich lange Füllzeichen, sodass Positionen erhalten bleiben. */
function maskiere(text: string): string {
  return text
    .replace(PLATZHALTER_MUSTER, fuelle)
    .replace(URL_MUSTER, (u) => {
      // Satzzeichen am Ende gehören nicht zur URL (auch eine schließende Klammer, wenn die URL selbst keine öffnende enthält)
      const ende = u.includes('(') ? /[.,;:!?]+$/ : /[.,;:!?)]+$/;
      const rest = u.match(ende)?.[0] ?? '';
      return fuelle(u.slice(0, u.length - rest.length)) + rest;
    });
}

const KONTEXT = 28;

function verstoss(text: string, regel: SchreibRegel, label: string, von: number, bis: number): SchreibVerstoss {
  const a = Math.max(0, von - KONTEXT);
  const b = Math.min(text.length, bis + KONTEXT);
  const roh = text.slice(a, b).replace(/\s/g, ' ');
  return { regel, label, stelle: `${a > 0 ? '…' : ''}${roh}${b < text.length ? '…' : ''}`, markVon: von - a + (a > 0 ? 1 : 0), markBis: bis - a + (a > 0 ? 1 : 0), von, bis };
}

/**
 * Prüft einen Text (Vorlage, Entwurf, Antwort) gegen die Prozessia-Schreibregeln. Leere Liste = in Ordnung.
 * `gespraech: false` lässt die Wahrheitsregel weg (z. B. beim Senden einer Antwort, wo ein Gespräch stattgefunden haben kann).
 */
export function pruefeSchreibregeln(text: string, opt: { gespraech?: boolean } = {}): SchreibVerstoss[] {
  const maske = maskiere(text);
  const liste: SchreibVerstoss[] = [];
  for (const r of REGELN) {
    for (const m of maske.matchAll(r.muster)) liste.push(verstoss(text, r.regel, r.label, m.index, m.index + m[0].length));
  }
  if (opt.gespraech !== false) {
    for (const g of GESPRAECH) {
      for (const m of maske.matchAll(g.muster)) liste.push(verstoss(text, 'gespraech', g.label, m.index, m.index + m[0].length));
    }
  }
  return liste.sort((x, y) => x.von - y.von);
}

/** Ob der Verstoß die reinen Stilregeln betrifft (nicht die Wahrheitsregel). */
export const istStilVerstoss = (v: SchreibVerstoss): boolean => v.regel !== 'gespraech';

/** Kurzfassung für Meldungen: „Gedankenstrich (– —), Klammern“ (jede Regel einmal). */
export function verstossLabels(v: SchreibVerstoss[]): string[] {
  return [...new Set(v.map((x) => x.label))];
}

/** Regeltext für System-Prompts der KI. */
export const SCHREIBREGELN_PROMPT = `Schreibregeln (zwingend): Verwende keine Gedankenstriche (– —), keine Bindestriche als Trenner (" - ") und keine runden Klammern. Formuliere stattdessen ganze Sätze oder nutze Doppelpunkt oder Komma. Bindestriche in zusammengesetzten Wörtern (E-Mail, KI-gestützt) sind erlaubt.
Behaupte nie ein Gespräch, das nicht stattgefunden hat: schreibe nicht "unser Telefonat", "Danke für das Gespräch", "wie besprochen" oder "mit Ihrer Abteilung telefoniert", außer es steht ausdrücklich im Verlauf.
Schreibe keinen Schlussgruß und keinen Namen: Gruß und Signatur werden automatisch angehängt.`;

/** Hinweis für den zweiten Versuch der KI */
export function korrekturHinweis(v: SchreibVerstoss[]): string {
  return `Dein letzter Text verletzte die Schreibregeln (${verstossLabels(v).join(', ')}). Schreibe ihn komplett ohne Gedankenstriche, Trenn-Bindestriche und Klammern neu und behaupte kein nicht belegtes Gespräch.`;
}

// ---------------------------------------------------------------- Schlussgruß

const GRUSS_START = /^(?:(?:mit\s+)?(?:(?:besten|freundlichen|herzlichen|sonnigen)\s+Grü(?:ß|ss)en|(?:beste|viele|freundliche|herzliche|schöne|sonnige|liebe)\s+Grü(?:ß|ss)e|freundlichem\s+Gruß)|freundlicher\s+Gruß|herzlichen\s+Gruß|hochachtungsvoll)/iu;
/** Nach dem Gruß höchstens ein Name oder „aus Ort“ (Großschreibung, bis zu drei Wörter), keine Sätze */
const GRUSS_REST = /^(?:[,\s]+(?:aus\s+)?\p{Lu}[\p{L}-]*(?:\s+\p{Lu}[\p{L}-]*){0,2})?[.!,]?$/u;

function istGrussZeile(zeile: string): boolean {
  const z = zeile.trim();
  const m = GRUSS_START.exec(z);
  return !!m && GRUSS_REST.test(z.slice(m[0].length));
}
const MAX_NACHLAUF_ZEILEN = 5;
const MAX_NACHLAUF_ZEICHEN = 60;

const norm = (s: string) => s.trim().replace(/[,.!]+$/, '').toLowerCase();

/**
 * Entfernt einen von der KI getippten Schlussgruß samt Namens-/Firmenzeilen am Ende (die Signatur des Postfachs ersetzt ihn),
 * wie strip_closing im Brain. Steht am Ende nur der Name des Absenders, wird auch er entfernt.
 */
export function entferneSchlussgruss(text: string, absenderName?: string | null): string {
  const zeilen = text.replace(/\r\n?/g, '\n').split('\n');
  while (zeilen.length > 0 && zeilen[zeilen.length - 1].trim() === '') zeilen.pop();
  // Grußzeile in den letzten Zeilen suchen; alles dahinter muss kurz sein (Name, Firma …)
  const ab = Math.max(0, zeilen.length - 1 - MAX_NACHLAUF_ZEILEN);
  for (let i = zeilen.length - 1; i >= ab; i--) {
    if (!istGrussZeile(zeilen[i])) continue;
    const nachlauf = zeilen.slice(i + 1).filter((z) => z.trim() !== '');
    if (nachlauf.every((z) => z.trim().length <= MAX_NACHLAUF_ZEICHEN)) {
      const rest = zeilen.slice(0, i);
      while (rest.length > 0 && rest[rest.length - 1].trim() === '') rest.pop();
      return rest.join('\n');
    }
  }
  // Nur der Name als letzte Zeile (nach einer Leerzeile)
  const name = norm(absenderName ?? '');
  const letzte = zeilen.length > 1 ? norm(zeilen[zeilen.length - 1]) : '';
  if (name && letzte && (letzte === name || letzte === name.split(/\s+/)[0]) && zeilen[zeilen.length - 2].trim() === '') {
    zeilen.pop();
    while (zeilen.length > 0 && zeilen[zeilen.length - 1].trim() === '') zeilen.pop();
  }
  return zeilen.join('\n');
}

// ---------------------------------------------------------------- Hilfe für die Editoren

export type OrtVerstoss = { ort: string; verstoss: SchreibVerstoss };

/** Prüft mehrere benannte Felder (z. B. Betreff, Text) und merkt sich, wo der Verstoß steht. */
export function pruefeFelder(felder: { ort: string; text: string }[]): OrtVerstoss[] {
  return felder.flatMap(({ ort, text }) => pruefeSchreibregeln(text).map((verstoss) => ({ ort, verstoss })));
}
