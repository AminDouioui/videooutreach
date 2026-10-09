import { randomBytes } from 'crypto';
import { begruessung } from './name';

// Reine Mail-Logik: Platzhalter, HTML/Text-Aufbau und RFC-2822-MIME. Keine DB-, Netz- oder Env-Zugriffe.

export type MailLead = {
  slug: string;
  firma: string;
  anrede?: string | null;
  vorname?: string | null;
  nachname?: string | null;
  renderedAt?: Date | null;
};

export type MailCampaign = {
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
  trackingPixel: boolean;
  /** false = Text-Kampagne: {{video_link}} und {{vorschaubild}} werden leer ersetzt */
  mitVideo?: boolean;
};

/** Für Follow-ups: eigener Text, Betreff „Re: …“ der Erstmail */
export type MailSchritt = { body: string };

export type MailSettings = {
  /** Basis-URL der App ohne Slash am Ende, z. B. https://video.example.de */
  appUrl: string;
  /** Signatur (mehrzeilig, Klartext) */
  signature: string;
};

export type BuiltEmail = { subject: string; html: string; text: string };

export const PLATZHALTER = [
  'begruessung',
  'anrede',
  'vorname',
  'nachname',
  'name',
  'firma',
  'video_link',
  'vorschaubild',
] as const;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Ersetzt `{{name}}` (Leerzeichen erlaubt, case-insensitiv). Unbekannte Platzhalter bleiben unverändert. */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (voll, key: string) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : voll;
  });
}

export function videoLink(appUrl: string, slug: string): string {
  return `${appUrl}/v/${slug}`;
}

export function thumbnailAbsUrl(appUrl: string, lead: Pick<MailLead, 'slug' | 'renderedAt'>): string {
  const v = lead.renderedAt ? `?v=${lead.renderedAt.getTime()}` : '';
  return `${appUrl}/media/${lead.slug}.jpg${v}`;
}

export function unsubscribePageUrl(appUrl: string, slug: string): string {
  return `${appUrl}/abmelden/${slug}`;
}

export function oneClickUrl(appUrl: string, slug: string): string {
  return `${appUrl}/api/unsubscribe/${slug}`;
}

function leadVars(lead: MailLead, appUrl: string): Record<string, string> {
  const vorname = (lead.vorname ?? '').trim();
  const nachname = (lead.nachname ?? '').trim();
  return {
    begruessung: begruessung(lead),
    anrede: (lead.anrede ?? '').trim(),
    vorname,
    nachname,
    name: [vorname, nachname].filter(Boolean).join(' '),
    firma: lead.firma.trim(),
    video_link: videoLink(appUrl, lead.slug),
  };
}

const BILD_TOKEN = '@@VORSCHAUBILD@@';
const BASIS_STIL = 'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5';

/** Wandelt bereits escapten Text in Absätze (<p>) mit <br> für einfache Zeilenumbrüche. */
function absaetze(escaped: string): string {
  return escaped
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => `<p style="margin:0 0 14px 0">${a.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/** Betreff eines Follow-ups: „Re: “ + Betreff der Erstmail (nicht doppelt). */
export function antwortBetreff(betreff: string): string {
  return /^re:/i.test(betreff.trim()) ? betreff.trim() : `Re: ${betreff.trim()}`;
}

/** Baut Betreff, HTML und Klartext einer Mail (mit `schritt` ein Follow-up im selben Thread). */
export function buildEmail(lead: MailLead, campaign: MailCampaign, settings: MailSettings, schritt?: MailSchritt): BuiltEmail {
  const appUrl = settings.appUrl.replace(/\/$/, '');
  const mitVideo = campaign.mitVideo !== false;
  const vars = leadVars(lead, appUrl);
  if (!mitVideo) vars.video_link = '';
  const link = vars.video_link;
  const thumb = thumbnailAbsUrl(appUrl, lead);
  const abmelden = unsubscribePageUrl(appUrl, lead.slug);
  const vorlage = schritt ? schritt.body : campaign.emailBodyTemplate;

  // Betreff: Klartext, ohne Zeilenumbrüche (Header-Injection verhindern)
  const ersterBetreff = renderTemplate(campaign.emailSubjectTemplate, { ...vars, vorschaubild: '' })
    .replace(/[\r\n]+/g, ' ')
    .trim();
  const subject = schritt ? antwortBetreff(ersterBetreff) : ersterBetreff;

  // Klartext
  const textVars = { ...vars, vorschaubild: mitVideo ? `Video ansehen: ${link}` : '' };
  const signaturText = settings.signature.replace(/\r\n?/g, '\n').trim();
  const text =
    [
      renderTemplate(vorlage.replace(/\r\n?/g, '\n'), textVars).trim(),
      signaturText ? `-- \n${signaturText}` : '',
      `Keine weiteren E-Mails? Hier abmelden: ${abmelden}`,
    ]
      .filter(Boolean)
      .join('\n\n') + '\n';

  // HTML: Vorlage und Werte escapen, Vorschaubild als Token einsetzen
  const htmlVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) htmlVars[k] = escapeHtml(v);
  htmlVars.vorschaubild = mitVideo ? BILD_TOKEN : '';
  const koerper = absaetze(renderTemplate(escapeHtml(vorlage), htmlVars));
  const bild =
    `<a href="${escapeHtml(link)}"><img src="${escapeHtml(thumb)}" alt="${escapeHtml(`Video für ${vars.firma} ansehen`)}" width="320" style="max-width:100%;height:auto;border:0"></a>` +
    `<br><a href="${escapeHtml(link)}">Video ansehen: ${escapeHtml(link)}</a>`;
  const koerperMitBild = koerper.split(BILD_TOKEN).join(bild);

  const signaturHtml = signaturText ? `<p style="margin:0 0 14px 0">${escapeHtml(signaturText).replace(/\n/g, '<br>')}</p>` : '';
  const pixel = campaign.trackingPixel
    ? `<img src="${escapeHtml(`${appUrl}/api/o/${lead.slug}.gif`)}" width="1" height="1" alt="" style="border:0">`
    : '';

  const html =
    `<!DOCTYPE html>\n<html lang="de"><head><meta charset="utf-8"></head>` +
    `<body style="${BASIS_STIL}">\n${koerperMitBild}\n${signaturHtml}\n` +
    `<p style="margin:18px 0 0 0;font-size:11px;color:#666">Keine weiteren E-Mails? <a href="${escapeHtml(abmelden)}" style="color:#666">Hier abmelden</a></p>` +
    `${pixel}\n</body></html>`;

  return { subject, html, text };
}

// ---------------------------------------------------------------- MIME

const CRLF = '\r\n';

function istAscii(s: string): boolean {
  return /^[\x00-\x7f]*$/.test(s);
}

/** RFC 2047 „encoded-word“ (UTF-8, Base64), in Stücken ≤ 45 Byte an Zeichengrenzen. */
export function encodeHeaderWord(wert: string): string {
  if (istAscii(wert)) return wert;
  const woerter: string[] = [];
  let aktuell = '';
  for (const ch of wert) {
    if (Buffer.byteLength(aktuell + ch, 'utf8') > 45) {
      woerter.push(aktuell);
      aktuell = '';
    }
    aktuell += ch;
  }
  if (aktuell) woerter.push(aktuell);
  return woerter.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join(CRLF + ' ');
}

/** Absender mit Anzeigename: `"Name" <adresse>` bzw. encoded-word bei Sonderzeichen. */
export function formatAddress(a: { name?: string | null; email: string }): string {
  const name = (a.name ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!name) return a.email;
  if (!istAscii(name)) return `${encodeHeaderWord(name)} <${a.email}>`;
  return `"${name.replace(/(["\\])/g, '\\$1')}" <${a.email}>`;
}

/** Base64 in 76-Zeichen-Zeilen (RFC 2045). */
function base64Zeilen(s: string): string {
  return (Buffer.from(s, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join(CRLF);
}

function sauber(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim();
}

export type MimeOptions = {
  from: { name?: string | null; email: string };
  to: string;
  subject: string;
  html: string;
  text: string;
  listUnsubscribeUrl: string;
  listUnsubscribeMailto: string;
  /** Follow-up: Message-ID der Erstmail (In-Reply-To/References), damit es im selben Thread landet */
  inReplyTo?: string;
  /** Nur für Tests deterministisch */
  date?: Date;
  messageId?: string;
  boundary?: string;
};

/** Neue Message-ID für den Absender (`<zufall@domain>`). */
export function neueMessageId(fromEmail: string): string {
  const domain = fromEmail.split('@')[1] ?? 'localhost';
  return `<${randomBytes(12).toString('hex')}@${domain}>`;
}

/** Baut die RFC-2822-Nachricht (multipart/alternative, text + html, kein Anhang) als String. */
export function buildMimeText(o: MimeOptions): string {
  const boundary = o.boundary ?? `=_vo_${randomBytes(12).toString('hex')}`;
  const messageId = o.messageId ?? neueMessageId(o.from.email);
  const datum = (o.date ?? new Date()).toUTCString().replace('GMT', '+0000');

  const kopf = [
    `Date: ${datum}`,
    `From: ${formatAddress(o.from)}`,
    `To: ${sauber(o.to)}`,
    `Subject: ${encodeHeaderWord(sauber(o.subject))}`,
    `Message-ID: ${messageId}`,
    ...(o.inReplyTo ? [`In-Reply-To: ${sauber(o.inReplyTo)}`, `References: ${sauber(o.inReplyTo)}`] : []),
    'MIME-Version: 1.0',
    `List-Unsubscribe: <${sauber(o.listUnsubscribeUrl)}>, <${sauber(o.listUnsubscribeMailto)}>`,
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join(CRLF);

  const teil = (typ: string, inhalt: string) =>
    [`--${boundary}`, `Content-Type: ${typ}; charset="UTF-8"`, 'Content-Transfer-Encoding: base64', '', base64Zeilen(inhalt)].join(CRLF);

  // Klartext zuerst, HTML zuletzt (bevorzugte Variante)
  return [kopf, '', teil('text/plain', o.text), teil('text/html', o.html), `--${boundary}--`, ''].join(CRLF);
}

/** base64url (ohne Padding) für `users.messages.send`. */
export function toBase64Url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Wie buildMimeText, aber base64url-kodiert. */
export function buildMime(o: MimeOptions): string {
  return toBase64Url(buildMimeText(o));
}
