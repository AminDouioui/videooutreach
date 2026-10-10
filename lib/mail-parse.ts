// Reine Parser für gelesene Mails (Gmail users.threads.get, format=full): Base64url, MIME-Teile, Zeichensätze,
// HTML → Text und Abtrennen des zitierten Verlaufs. Keine DB-, Netz- oder Env-Zugriffe. Mail-HTML wird NIE gerendert,
// sondern hier zu reinem Text gemacht (die UI gibt ihn React-escaped aus).
//
// Hinweis zu quoted-printable/base64: Die Gmail-API liefert `body.data` bereits vom Content-Transfer-Encoding befreit
// (base64url der rohen Bytes im Original-Zeichensatz). Es wird deshalb NICHT erneut dekodiert; nur der Zeichensatz
// (charset aus dem Content-Type) wird angewendet.

/** Teil einer Gmail-Nachricht (Ausschnitt von users.messages#payload) */
export type GmailTeil = {
  mimeType?: string | null;
  filename?: string | null;
  headers?: { name?: string | null; value?: string | null }[] | null;
  body?: { data?: string | null; size?: number | null; attachmentId?: string | null } | null;
  parts?: GmailTeil[] | null;
};

/** Nachricht, wie users.threads.get sie liefert (Ausschnitt) */
export type GmailNachricht = {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
  internalDate?: string | null;
  payload?: GmailTeil | null;
};

/** Eine gelesene Nachricht für die Anzeige */
export type ThreadNachricht = {
  id: string;
  von: string;
  an: string;
  /** Unix-ms, null = unbekannt */
  datum: number | null;
  betreff: string;
  /** Neuer Text ohne zitierten Verlauf */
  text: string;
  /** Zitierter Verlauf (einklappbar), leer wenn keiner erkannt */
  zitat: string;
  /** true = vom eigenen Postfach gesendet */
  eigene: boolean;
};

/** Zusätzliche Kopfzeilen, die für die Antwort im Thread gebraucht werden */
export type NachrichtMitKopf = ThreadNachricht & { messageId: string | null; references: string | null; replyTo: string | null };

/** Obergrenze je Nachricht (Zeichen); mehr wird abgeschnitten, damit riesige Mails die Seite nicht sprengen */
export const MAX_TEXT_ZEICHEN = 50_000;

// ---------------------------------------------------------------- Base64url & Zeichensätze

/** Dekodiert base64url (mit oder ohne Padding, auch normales Base64) zu Bytes. */
export function dekodiereBase64Url(s: string): Buffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  return Buffer.from(b64, 'base64');
}

// Windows-1252 weicht von ISO-8859-1 in 0x80–0x9F ab (€, Anführungszeichen …); nicht jede Node-Version bildet das korrekt ab
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

/** Dekodiert Bytes mit dem angegebenen Zeichensatz (unbekannt/fehlend = UTF-8). */
export function dekodiereZeichensatz(bytes: Uint8Array, charset?: string | null): string {
  let label = (charset ?? 'utf-8').trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (!label || label === 'us-ascii' || label === 'ascii') label = 'utf-8';
  if (label === 'latin1' || label === 'latin-1') label = 'iso-8859-1';
  if (label === 'windows-1252' || label === 'cp1252') {
    return Array.from(bytes, (b) => (b >= 0x80 && b <= 0x9f ? CP1252[b - 0x80] : String.fromCharCode(b))).join('');
  }
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Wert einer Kopfzeile (Name ohne Beachtung der Groß-/Kleinschreibung) */
export function kopfzeile(teil: Pick<GmailTeil, 'headers'> | null | undefined, name: string): string {
  const n = name.toLowerCase();
  for (const h of teil?.headers ?? []) if ((h.name ?? '').toLowerCase() === n && h.value) return h.value;
  return '';
}

function charsetVon(teil: GmailTeil): string | null {
  const m = /charset\s*=\s*"?([^";\s]+)"?/i.exec(kopfzeile(teil, 'content-type'));
  return m ? m[1] : null;
}

function teilText(teil: GmailTeil): string {
  const daten = teil.body?.data;
  if (!daten) return '';
  return dekodiereZeichensatz(dekodiereBase64Url(daten), charsetVon(teil));
}

// ---------------------------------------------------------------- HTML → Text

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  euro: '€', hellip: '…', ndash: '–', mdash: '—', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚', laquo: '«', raquo: '»',
  copy: '©', reg: '®', middot: '·', bull: '•', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', deg: '°', sect: '§', pound: '£', trade: '™',
};

/** Dekodiert benannte und numerische (dezimal/hex) HTML-Entities; Unbekanntes bleibt stehen. */
export function dekodiereEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (voll, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return code === 0xa0 ? ' ' : String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : voll;
  });
}

/** Tags → Zeilenumbrüche/Text, ohne Entities (Blöcke: Absatz, Zeile, Listenpunkt). */
function htmlOhneTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|ul|ol|table|section|article|pre)\s*>/gi, '\n\n')
    .replace(/<\/(li|td|th)\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '');
}

function mitAnfuehrung(text: string): string {
  return text
    .split('\n')
    .map((z) => `> ${z}`.trimEnd())
    .join('\n');
}

/** Wandelt Mail-HTML in reinen Text (Skripte/Styles/Kommentare entfernt, Zitate als „> “-Zeilen, Entities dekodiert). */
export function htmlZuText(html: string): string {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|head|title)\b[^>]*>/gi, '');
  // Zitierte Blöcke von innen nach außen zu „> “-Zeilen machen (schachtelungsfest, Obergrenze gegen Endlosschleifen)
  const BQ = /<blockquote\b[^>]*>((?:(?!<blockquote\b)[\s\S])*?)<\/blockquote\s*>/i;
  for (let i = 0; i < 50 && BQ.test(h); i++) {
    h = h.replace(BQ, (_v, inner: string) => `\n\n${mitAnfuehrung(htmlOhneTags(inner).replace(/\n{3,}/g, '\n\n').trim())}\n\n`);
  }
  return normalisiere(dekodiereEntities(htmlOhneTags(h)));
}

/** Zeilenenden vereinheitlichen, Zeilenenden-Leerraum entfernen, mehr als eine Leerzeile zusammenfassen. */
export function normalisiere(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[ \t ]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------- Text aus MIME-Baum

type Fund = { text: string; art: 'plain' | 'html' } | null;

function sucheText(teil: GmailTeil): Fund {
  const typ = (teil.mimeType ?? '').toLowerCase();
  if (teil.filename) return null; // Anhang
  if (typ === 'text/plain') {
    const t = normalisiere(teilText(teil));
    return t ? { text: t, art: 'plain' } : null;
  }
  if (typ === 'text/html') {
    const t = htmlZuText(teilText(teil));
    return t ? { text: t, art: 'html' } : null;
  }
  if (typ.startsWith('multipart/') || teil.parts?.length) {
    const funde = (teil.parts ?? []).map(sucheText).filter((f): f is NonNullable<Fund> => f !== null);
    if (funde.length === 0) return null;
    if (typ === 'multipart/alternative') return funde.find((f) => f.art === 'plain') ?? funde[0];
    // mixed/related: Teile hintereinander (z. B. Text + weiterer Textteil)
    const art = funde.some((f) => f.art === 'plain') ? 'plain' : 'html';
    return { text: funde.map((f) => f.text).join('\n\n'), art };
  }
  // Einteilige Nachricht ohne bekannten Typ, aber mit Text
  if (!typ && teil.body?.data) {
    const t = normalisiere(teilText(teil));
    return t ? { text: t, art: 'plain' } : null;
  }
  return null;
}

/** Lesbarer Text einer Nachricht: text/plain bevorzugt, sonst HTML → Text; Anhänge werden ignoriert. */
export function extrahiereText(payload: GmailTeil | null | undefined): string {
  if (!payload) return '';
  return sucheText(payload)?.text ?? '';
}

// ---------------------------------------------------------------- Zitierter Verlauf

const ATTRIBUTION = /^(am|on)\s.{3,400}?\b(schrieb|wrote)\b.*:\s*$/i;
const ORIGINAL = /^[-_=\s]*(original message|ursprüngliche nachricht|urspr\S* nachricht|weitergeleitete nachricht|forwarded message|original-nachricht)[-_=\s]*$/i;

function beginntZitat(zeilen: string[], i: number): boolean {
  const z = zeilen[i].trim();
  if (ORIGINAL.test(z)) return true;
  // Outlook-Kopf: „Von: …“ gefolgt von „Gesendet:/Sent:/Datum:“
  if (/^(von|from):\s/i.test(z) && zeilen.slice(i + 1, i + 4).some((n) => /^(gesendet|sent|datum|date):/i.test(n.trim()))) return true;
  if (/^(am|on)\s/i.test(z)) {
    // Gmail bricht lange Zeilen um: bis zu drei Zeilen zusammen prüfen
    for (let n = 0; n < 3 && i + n < zeilen.length; n++) {
      const kombiniert = zeilen.slice(i, i + n + 1).map((x) => x.trim()).join(' ');
      if (ATTRIBUTION.test(kombiniert)) return true;
    }
  }
  return false;
}

/**
 * Trennt den zitierten Verlauf ab: ab einer „Am … schrieb …:“-/„On … wrote:“-Zeile, einem Original-Nachricht-Trenner
 * oder einem Outlook-Kopf ist alles Zitat. Ohne solche Zeile werden „>“-Zeilen als Zitat herausgelöst.
 */
export function trenneVerlauf(text: string): { neu: string; zitat: string } {
  const zeilen = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < zeilen.length; i++) {
    if (beginntZitat(zeilen, i)) {
      return { neu: normalisiere(zeilen.slice(0, i).join('\n')), zitat: normalisiere(zeilen.slice(i).join('\n')) };
    }
  }
  const neu: string[] = [];
  const zitat: string[] = [];
  for (const z of zeilen) (/^\s*>/.test(z) ? zitat : neu).push(z);
  return { neu: normalisiere(neu.join('\n')), zitat: normalisiere(zitat.join('\n')) };
}

// ---------------------------------------------------------------- Adressen & Nachricht

/** Reine Adresse aus „Name <a@b.de>“ bzw. „a@b.de“ (klein geschrieben); leer, wenn keine erkennbar. */
export function extrahiereAdresse(wert: string): string {
  const spitz = /<([^<>\s]+@[^<>\s]+)>/.exec(wert);
  if (spitz) return spitz[1].toLowerCase();
  const m = /[^\s<>",;]+@[^\s<>",;]+/.exec(wert);
  return m ? m[0].toLowerCase() : '';
}

function datumVon(msg: GmailNachricht): number | null {
  const intern = Number(msg.internalDate);
  if (Number.isFinite(intern) && intern > 0) return intern;
  const d = Date.parse(kopfzeile(msg.payload, 'date'));
  return Number.isNaN(d) ? null : d;
}

/** Kopfzeilenwert ohne Zeilenumbrüche */
function einzeilig(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim();
}

/** Wandelt eine Gmail-Nachricht in die Anzeigeform. `eigeneAdresse` = Adresse des Postfachs (für „eigene“). */
export function parseNachricht(msg: GmailNachricht, eigeneAdresse: string): NachrichtMitKopf {
  const von = einzeilig(kopfzeile(msg.payload, 'from'));
  const eigen = eigeneAdresse.trim().toLowerCase();
  const eigene = (!!eigen && extrahiereAdresse(von) === eigen) || (msg.labelIds ?? []).includes('SENT');
  const roh = extrahiereText(msg.payload);
  const abgeschnitten = roh.length > MAX_TEXT_ZEICHEN ? `${roh.slice(0, MAX_TEXT_ZEICHEN)}\n\n[… Text gekürzt]` : roh;
  const { neu, zitat } = trenneVerlauf(abgeschnitten);
  return {
    id: msg.id ?? '',
    von,
    an: einzeilig(kopfzeile(msg.payload, 'to')),
    datum: datumVon(msg),
    betreff: einzeilig(kopfzeile(msg.payload, 'subject')),
    // Nur Zitat vorhanden (z. B. leere Antwort unter Zitat): lieber den Text zeigen als eine leere Karte
    text: neu || (zitat ? '' : abgeschnitten),
    zitat,
    eigene,
    messageId: einzeilig(kopfzeile(msg.payload, 'message-id')) || null,
    references: einzeilig(kopfzeile(msg.payload, 'references')) || null,
    replyTo: einzeilig(kopfzeile(msg.payload, 'reply-to')) || null,
  };
}

/** Nachrichten eines Threads in zeitlicher Reihenfolge (stabil), eigene Adresse bestimmt `eigene`. */
export function parseThread(nachrichten: GmailNachricht[], eigeneAdresse: string): NachrichtMitKopf[] {
  return nachrichten
    .map((m, i) => ({ n: parseNachricht(m, eigeneAdresse), i }))
    .sort((a, b) => (a.n.datum ?? 0) - (b.n.datum ?? 0) || a.i - b.i)
    .map((x) => x.n);
}

/** Nur die Felder für die Anzeige (ohne interne Kopfzeilen) */
export function fuerAnzeige(n: NachrichtMitKopf): ThreadNachricht {
  const { messageId: _m, references: _r, replyTo: _p, ...rest } = n;
  void _m;
  void _r;
  void _p;
  return rest;
}
