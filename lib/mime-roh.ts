import { dekodiereZeichensatz, type GmailNachricht, type GmailTeil } from './mail-parse';

// Einfacher MIME-Parser für Rohnachrichten (IMAP-Quelltext, RFC 5322): Kopfzeilen entfalten und dekodieren,
// multipart-Bäume zerlegen, Content-Transfer-Encoding (base64 / quoted-printable) auflösen. Das Ergebnis hat dieselbe
// Form wie die Gmail-API (`GmailTeil`, `body.data` = base64url der bereits dekodierten Bytes), damit lib/mail-parse.ts
// ohne Änderung weiterverwendet werden kann. Rein, ohne Netz/DB; keine Fremdbibliothek.

const MAX_TIEFE = 8;
const MAX_TEILE = 100;

export type Kopfzeile = { name: string; wert: string };

/** Teilt Rohnachricht (Bytes) in Kopf (Text) und Körper (Bytes) am ersten Leerzeilen-Umbruch. */
export function trenneKopfKoerper(roh: Buffer): { kopf: string; koerper: Buffer } {
  const crlf = roh.indexOf('\r\n\r\n');
  const lf = roh.indexOf('\n\n');
  let ende = -1;
  let laenge = 0;
  if (crlf !== -1 && (lf === -1 || crlf <= lf)) {
    ende = crlf;
    laenge = 4;
  } else if (lf !== -1) {
    ende = lf;
    laenge = 2;
  }
  if (ende === -1) return { kopf: roh.toString('latin1'), koerper: Buffer.alloc(0) };
  return { kopf: roh.subarray(0, ende).toString('latin1'), koerper: roh.subarray(ende + laenge) };
}

/** RFC 2047 „encoded-words“ (B und Q) dekodieren; Leerraum zwischen direkt aufeinanderfolgenden Wörtern entfällt. */
export function dekodiereEncodedWords(s: string): string {
  const zusammen = s.replace(/(\?=)\s+(=\?)/g, '$1$2');
  return zusammen.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (_v, charset: string, enc: string, daten: string) => {
    try {
      const cs = charset.replace(/\*.*$/, '');
      const bytes = enc.toLowerCase() === 'b' ? Buffer.from(daten, 'base64') : decodeQuotedPrintable(daten.replace(/_/g, ' '), true);
      return dekodiereZeichensatz(bytes, cs);
    } catch {
      return _v;
    }
  });
}

/** Quoted-printable → Bytes. `wort` = Variante der encoded-words (kein Zeilenumbruch-Sonderfall). */
export function decodeQuotedPrintable(s: string, wort = false): Buffer {
  const text = wort ? s : s.replace(/=\r?\n/g, '');
  const aus: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x3d && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      aus.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (c < 256) aus.push(c);
    else for (const b of Buffer.from(text[i], 'utf8')) aus.push(b);
  }
  return Buffer.from(aus);
}

/** Kopfzeilen entfalten und Werte dekodieren. Namen bleiben im Original, Reihenfolge erhalten. */
export function parseKopfzeilen(kopf: string): Kopfzeile[] {
  const zeilen = kopf.replace(/\r\n?/g, '\n').split('\n');
  const aus: Kopfzeile[] = [];
  for (const z of zeilen) {
    if (/^[ \t]/.test(z) && aus.length > 0) {
      aus[aus.length - 1].wert += ` ${z.trim()}`;
      continue;
    }
    const i = z.indexOf(':');
    if (i <= 0) continue;
    aus.push({ name: z.slice(0, i).trim(), wert: z.slice(i + 1).trim() });
  }
  // Kopfzeilen sind laut RFC ASCII; manche Server liefern rohes UTF-8 (latin1 gelesen) – dann zurückwandeln
  return aus.map((h) => ({ name: h.name, wert: dekodiereEncodedWords(/[\u0080-ÿ]/.test(h.wert) ? utf8Falls(h.wert) : h.wert) }));
}

function utf8Falls(latin1: string): string {
  const bytes = Buffer.from(latin1, 'latin1');
  const utf8 = bytes.toString('utf8');
  return utf8.includes('�') ? latin1 : utf8;
}

/** Kopfzeilen als Map (Namen klein); doppelte Namen: erster Wert, bei In-Reply-To/References zusammengefügt. */
export function kopfMap(zeilen: Kopfzeile[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const h of zeilen) {
    const n = h.name.toLowerCase();
    if (n in m) {
      if (n === 'references' || n === 'in-reply-to') m[n] = `${m[n]} ${h.wert}`;
      continue;
    }
    m[n] = h.wert;
  }
  return m;
}

/** Kopfzeilen einer Rohnachricht als Map (Namen klein, Werte dekodiert). */
export function kopfAusRoh(roh: Buffer): Record<string, string> {
  return kopfMap(parseKopfzeilen(trenneKopfKoerper(roh).kopf));
}

function parameter(wert: string, name: string): string | null {
  const m = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^;\\s]+))`, 'i').exec(wert);
  if (!m) return null;
  return (m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1');
}

function dekodiereKoerper(koerper: Buffer, cte: string): Buffer {
  const e = cte.trim().toLowerCase();
  if (e === 'base64') return Buffer.from(koerper.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (e === 'quoted-printable') return decodeQuotedPrintable(koerper.toString('latin1'));
  return koerper;
}

function teilAus(roh: Buffer, tiefe: number, zaehler: { n: number }): GmailTeil {
  const { kopf, koerper } = trenneKopfKoerper(roh);
  const zeilen = parseKopfzeilen(kopf);
  const map = kopfMap(zeilen);
  const ct = map['content-type'] ?? 'text/plain; charset=us-ascii';
  const mimeType = (ct.split(';')[0] ?? 'text/plain').trim().toLowerCase();
  const teil: GmailTeil = { mimeType, headers: zeilen.map((h) => ({ name: h.name, value: h.wert })) };
  const dispo = map['content-disposition'] ?? '';
  const dateiname = parameter(dispo, 'filename') ?? parameter(ct, 'name');
  if (dateiname) teil.filename = dateiname;

  if (mimeType.startsWith('multipart/') && tiefe < MAX_TIEFE) {
    const grenze = parameter(ct, 'boundary');
    if (grenze) {
      teil.parts = zerlege(koerper, grenze).flatMap((p) => {
        if (zaehler.n >= MAX_TEILE) return [];
        zaehler.n++;
        return [teilAus(p, tiefe + 1, zaehler)];
      });
      return teil;
    }
  }
  // Nur Textteile werden dekodiert und mitgeführt (Anhänge und eingebettete Nachrichten bleiben leer)
  if (mimeType === 'text/plain' || mimeType === 'text/html') {
    const daten = dekodiereKoerper(koerper, map['content-transfer-encoding'] ?? '7bit');
    teil.body = { data: daten.toString('base64url'), size: daten.length };
  }
  return teil;
}

/** Zerlegt einen multipart-Körper an der Grenze in die Teile (jeweils Kopf + Körper als Bytes). */
function zerlege(koerper: Buffer, grenze: string): Buffer[] {
  const text = koerper.toString('latin1');
  const marke = `--${grenze}`;
  const teile: Buffer[] = [];
  let pos = 0;
  let start = -1;
  while (pos <= text.length) {
    const i = text.indexOf(marke, pos);
    if (i === -1) break;
    // Marke muss am Zeilenanfang stehen
    if (i > 0 && text[i - 1] !== '\n') {
      pos = i + marke.length;
      continue;
    }
    if (start !== -1) {
      let ende = i;
      // Zeilenumbruch vor der Marke gehört zur Marke
      if (text[ende - 1] === '\n') ende--;
      if (text[ende - 1] === '\r') ende--;
      teile.push(koerper.subarray(start, ende));
    }
    const nach = i + marke.length;
    if (text.startsWith('--', nach)) return teile;
    const zeilenEnde = text.indexOf('\n', nach);
    if (zeilenEnde === -1) return teile;
    start = zeilenEnde + 1;
    pos = start;
  }
  if (start !== -1) teile.push(koerper.subarray(start));
  return teile;
}

/** Parst eine Rohnachricht zu einem MIME-Baum im Gmail-API-Format. */
export function parseRohnachricht(roh: Buffer): GmailTeil {
  return teilAus(roh, 0, { n: 0 });
}

/** Rohnachricht → Gmail-Nachricht (für parseThread). `datum` = Zeitpunkt in ms (z. B. IMAP INTERNALDATE). */
export function rohZuNachricht(roh: Buffer, opt: { id: string; datum: number | null; gesendet: boolean }): GmailNachricht {
  return {
    id: opt.id,
    threadId: null,
    labelIds: opt.gesendet ? ['SENT'] : [],
    internalDate: opt.datum ? String(opt.datum) : null,
    payload: parseRohnachricht(roh),
  };
}
