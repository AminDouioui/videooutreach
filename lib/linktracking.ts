import { createHmac } from 'crypto';
import { timingSafeEqualStr } from './auth';

// Klick-Tracking für Links im Mailtext (reine Logik, keine DB-/Env-Zugriffe).
//
// Token = base64url("<slug>\n<url>") + "." + HMAC-SHA256-Signatur (128 Bit). Gewählt statt einer `links`-Tabelle:
//  - buildEmail bleibt rein: Vorschau, Testmail und Worker brauchen keine DB-Schreibzugriffe,
//  - stabil je Lead+URL ohne Zustand (gleiche Eingabe = gleiches Token), keine Aufräum-/Backfill-Logik,
//  - nicht erratbar und nicht fälschbar: ohne den geheimen Schlüssel lässt sich kein Token für eine fremde URL
//    erzeugen. Die Route leitet daher nur auf URLs weiter, die tatsächlich für diesen Lead signiert wurden
//    (kein Open-Redirect). Preis: Der Schlüssel (ENCRYPTION_KEY) darf nicht rotiert werden, sonst werden bereits
//    versendete Links ungültig – bei ENCRYPTION_KEY gilt das ohnehin (verschlüsselte Postfach-Tokens).

/** Längere URLs werden nicht umgeleitet (Token würde zu lang). */
export const MAX_URL_LAENGE = 1500;

/** Pfade der eigenen App, die nie umgeleitet werden: Video-Link, Abmeldung, Medien, Pixel, bereits getrackte Links. */
const AUSNAHMEN = ['/v/', '/r/', '/abmelden/', '/api/unsubscribe/', '/media/', '/api/o/', '/api/c/'];

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signatur(schluessel: string, slug: string, url: string): string {
  return b64url(createHmac('sha256', schluessel).update(`link-click-v1\n${slug}\n${url}`).digest()).slice(0, 22);
}

/** Nur absolute http(s)-URLs ohne Steuer-/Leerzeichen sind erlaubt. */
export function istHttpUrl(url: string): boolean {
  if (url.length > MAX_URL_LAENGE || /[\s\u0000-\u001f]/.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Token für (Lead, URL); null, wenn die URL nicht umgeleitet werden darf. */
export function erzeugeLinkToken(schluessel: string, slug: string, url: string): string | null {
  if (!schluessel || !slug || slug.includes('\n') || !istHttpUrl(url)) return null;
  return `${b64url(Buffer.from(`${slug}\n${url}`, 'utf8'))}.${signatur(schluessel, slug, url)}`;
}

/** Prüft ein Token; liefert Slug und Ziel-URL oder null (ungültig, manipuliert, fremder Schlüssel). */
export function pruefeLinkToken(schluessel: string, token: string): { slug: string; url: string } | null {
  if (!schluessel || token.length > 4000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/.test(token)) return null;
  const [daten, sig] = token.split('.');
  const dekodiert = Buffer.from(daten.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const i = dekodiert.indexOf('\n');
  if (i <= 0) return null;
  const slug = dekodiert.slice(0, i);
  const url = dekodiert.slice(i + 1);
  if (!timingSafeEqualStr(sig, signatur(schluessel, slug, url))) return null;
  return istHttpUrl(url) ? { slug, url } : null;
}

/** Ist das ein eigener Link der App, der nicht getrackt werden soll (Video, Abmeldung, Bild …)? */
export function istAusnahme(appUrl: string, url: string): boolean {
  return AUSNAHMEN.some((p) => url.startsWith(`${appUrl}${p}`));
}

export function klickUrl(appUrl: string, token: string, vorschau = false): string {
  return `${appUrl}/api/c/${token}${vorschau ? '?vorschau=1' : ''}`;
}

export type LinkOptionen = { appUrl: string; schluessel: string; slug: string; vorschau?: boolean };

/** Getrackte URL für `url` oder null, wenn sie unverändert bleiben soll. */
function ersatzUrl(url: string, o: LinkOptionen): string | null {
  if (istAusnahme(o.appUrl, url)) return null;
  const token = erzeugeLinkToken(o.schluessel, o.slug, url);
  return token ? klickUrl(o.appUrl, token, o.vorschau) : null;
}

/** Entfernt Satzzeichen am Ende einer im Fließtext gefundenen URL („… siehe https://x.de/a.“). */
function ohneSchlusszeichen(url: string): string {
  let u = url;
  for (;;) {
    const k = u.replace(/[.,;:!?)\]}]+$/, '');
    if (k === u) return u;
    u = k;
  }
}

const URL_MUSTER = /https?:\/\/[^\s<>"]+/gi;
// Im bereits escapten HTML enden URLs an Entities für < > "
const URL_MUSTER_HTML = /https?:\/\/(?:(?!&lt;|&gt;|&quot;)[^\s<>"])+/gi;

function entescape(s: string): string {
  return s.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** Klartext: ersetzt http(s)-URLs durch getrackte URLs. */
export function trackeText(text: string, o: LinkOptionen): string {
  return text.replace(URL_MUSTER, (treffer) => {
    const url = ohneSchlusszeichen(treffer);
    const neu = ersatzUrl(url, o);
    return neu ? neu + treffer.slice(url.length) : treffer;
  });
}

/**
 * HTML (bereits escapter Mailtext, nur Text und <br>/<p>): macht http(s)-URLs zu Links mit getrackter Adresse.
 * Der sichtbare Text bleibt die Original-URL. Eigene Links der Ausnahmeliste und alles andere bleibt unverändert.
 */
export function trackeHtml(htmlText: string, escapeHtml: (s: string) => string, o: LinkOptionen): string {
  return htmlText.replace(URL_MUSTER_HTML, (treffer) => {
    const sichtbar = ohneSchlusszeichen(treffer);
    const neu = ersatzUrl(entescape(sichtbar), o);
    return neu ? `<a href="${escapeHtml(neu)}">${sichtbar}</a>${treffer.slice(sichtbar.length)}` : treffer;
  });
}
