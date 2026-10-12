import { describe, expect, it } from 'vitest';
import { buildMime, buildMimeText, type MimeAnhang, type MimeOptions } from './mail';
import { dekodiereBase64Url } from './mail-parse';
import { extrahiereText } from './mail-parse';
import { kopfAusRoh, parseRohnachricht, trenneKopfKoerper } from './mime-roh';

const basis: MimeOptions = {
  from: { name: 'Amin Douioui', email: 'amin@prozessia.de' },
  to: 'max@firma.de',
  subject: 'Kurzes Video für Müller',
  html: '<p>Hallo Grüße</p>',
  text: 'Hallo Grüße',
  listUnsubscribeUrl: 'https://video.example.de/api/unsubscribe/x',
  listUnsubscribeMailto: 'mailto:amin@prozessia.de?subject=Abmelden',
  boundary: 'BOUNDARY',
  messageId: '<abc@prozessia.de>',
  date: new Date('2026-07-15T08:00:00Z'),
};

// Zufällige, nicht ASCII-lesbare Bytes, damit Base64 echte Zeilenumbrüche braucht
const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37 + 11) % 256))]);
const anhang = (dateiname: string, inhalt = pdfBytes, mime = 'application/pdf'): MimeAnhang => ({ dateiname, mime, inhalt });

/** Teile eines multipart-Körpers (Rohtext) zwischen den Grenzen */
function teile(roh: string, grenze: string): string[] {
  return roh.split(`--${grenze}`).slice(1, -1).map((t) => t.replace(/^\r\n/, '').replace(/\r\n$/, ''));
}

describe('MIME ohne Anhänge', () => {
  it('bleibt multipart/alternative ohne mixed, ohne Disposition (unverändert zu vorher)', () => {
    const roh = buildMimeText(basis);
    expect(roh).toContain('Content-Type: multipart/alternative; boundary="BOUNDARY"');
    expect(roh).not.toMatch(/multipart\/mixed|Content-Disposition|_alt/i);
    expect(buildMimeText({ ...basis, anhaenge: [] })).toBe(roh);
    // Grenzen: genau zwei Teile + Ende
    expect(roh.match(/--BOUNDARY/g)).toHaveLength(3);
  });
});

describe('MIME mit Anhängen', () => {
  const roh = buildMimeText({ ...basis, anhaenge: [anhang('Angebot.pdf'), anhang('Übersicht Größe.pdf')] });

  it('Struktur: multipart/mixed { multipart/alternative { text, html }, Anhang, Anhang }', () => {
    const kopf = kopfAusRoh(Buffer.from(roh));
    expect(kopf['content-type']).toBe('multipart/mixed; boundary="BOUNDARY"');
    // Kopfzeilen für Threading und Abmeldung bleiben erhalten
    expect(kopf['list-unsubscribe-post']).toBe('List-Unsubscribe=One-Click');
    const baum = parseRohnachricht(Buffer.from(roh));
    expect(baum.mimeType).toBe('multipart/mixed');
    expect(baum.parts).toHaveLength(3);
    const [alt, a1, a2] = baum.parts!;
    expect(alt.mimeType).toBe('multipart/alternative');
    expect(alt.parts?.map((p) => p.mimeType)).toEqual(['text/plain', 'text/html']);
    expect(a1.mimeType).toBe('application/pdf');
    expect(a2.mimeType).toBe('application/pdf');
    // Text und HTML sind weiterhin lesbar
    expect(extrahiereText(baum).trim()).toBe('Hallo Grüße');
  });

  it('Dateinamen: ASCII direkt, Umlaute per RFC 2047 und RFC 2231', () => {
    const baum = parseRohnachricht(Buffer.from(roh));
    expect(baum.parts![1].filename).toBe('Angebot.pdf');
    expect(baum.parts![2].filename).toBe('Übersicht Größe.pdf');
    expect(roh).toContain('filename="Angebot.pdf"');
    expect(roh).toMatch(/filename\*=UTF-8''%C3%9Cbersicht%20Gr%C3%B6%C3%9Fe\.pdf/);
    expect(roh).toMatch(/filename="=\?UTF-8\?B\?/);
    expect(roh).toMatch(/Content-Disposition: attachment;/);
    // Keine rohen Umlaute im Header (alles 7-bit)
    const { kopf } = trenneKopfKoerper(Buffer.from(roh));
    expect(/^[\x00-\x7f]*$/.test(kopf)).toBe(true);
  });

  it('Anhang-Inhalt bleibt byte-genau, Base64-Zeilen höchstens 76 Zeichen', () => {
    const [, a1] = teile(roh, 'BOUNDARY').slice(0, 3).map((t) => t);
    expect(a1).toContain('Content-Transfer-Encoding: base64');
    const koerper = a1.split('\r\n\r\n').slice(1).join('\r\n\r\n');
    const zeilen = koerper.split('\r\n');
    expect(zeilen.length).toBeGreaterThan(10);
    for (const z of zeilen) expect(z.length).toBeLessThanOrEqual(76);
    expect(Buffer.from(zeilen.join(''), 'base64').equals(pdfBytes)).toBe(true);
    // Gesamte Nachricht: keine Zeile länger als 998 (RFC 5322)
    for (const z of roh.split('\r\n')) expect(z.length).toBeLessThanOrEqual(998);
  });

  it('endet mit abschließender äußerer Grenze; innere Grenze ist eine andere', () => {
    expect(roh.trimEnd().endsWith('--BOUNDARY--')).toBe(true);
    expect(roh).toContain('boundary="alt_BOUNDARY"');
    expect(roh.match(/--alt_BOUNDARY--/g)).toHaveLength(1);
  });

  it('base64url-Form (Gmail-API und SMTP-Treiber) ist dekodierbar und identisch', () => {
    const b = buildMime({ ...basis, anhaenge: [anhang('Angebot.pdf')] });
    expect(b).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(dekodiereBase64Url(b).toString('utf8')).toBe(buildMimeText({ ...basis, anhaenge: [anhang('Angebot.pdf')] }));
  });

  it('Threading-Header bleiben mit Anhängen erhalten', () => {
    const r = buildMimeText({ ...basis, inReplyTo: '<erst@prozessia.de>', references: '<erst@prozessia.de>', anhaenge: [anhang('a.pdf')] });
    const kopf = kopfAusRoh(Buffer.from(r));
    expect(kopf['in-reply-to']).toBe('<erst@prozessia.de>');
    expect(kopf['references']).toBe('<erst@prozessia.de>');
  });

  it('lange Namen mit Sonderzeichen, Anführungszeichen und Zeilenumbrüchen erzeugen keine Header-Injektion', () => {
    const r = buildMimeText({ ...basis, anhaenge: [anhang('Böse"\r\nBcc: evil@x.de.pdf'), anhang(`${'ü'.repeat(100)}.pdf`)] });
    expect(r).not.toMatch(/\r\nBcc:/);
    const baum = parseRohnachricht(Buffer.from(r));
    expect(baum.parts).toHaveLength(3);
    expect(baum.parts![2].filename).toBe(`${'ü'.repeat(100)}.pdf`);
    expect(/^[\x00-\x7f]*$/.test(trenneKopfKoerper(Buffer.from(r)).kopf)).toBe(true);
  });

  it('unbekannter MIME-Typ fällt auf application/octet-stream zurück', () => {
    const r = buildMimeText({ ...basis, anhaenge: [anhang('a.bin', Buffer.from('x'), 'in valid\r\n')] });
    expect(r).toContain('Content-Type: invalid;');
  });
});
