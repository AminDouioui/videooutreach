import { describe, expect, it } from 'vitest';
import {
  dekodiereBase64Url,
  dekodiereEntities,
  dekodiereZeichensatz,
  extrahiereAdresse,
  extrahiereText,
  fuerAnzeige,
  htmlZuText,
  parseNachricht,
  parseThread,
  trenneVerlauf,
  type GmailNachricht,
  type GmailTeil,
} from './mail-parse';

const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const teil = (mimeType: string, inhalt: string | Buffer, charset?: string): GmailTeil => ({
  mimeType,
  headers: [{ name: 'Content-Type', value: `${mimeType}${charset ? `; charset="${charset}"` : ''}` }],
  body: { data: b64u(inhalt), size: inhalt.length },
});
const multi = (mimeType: string, parts: GmailTeil[]): GmailTeil => ({ mimeType, parts });
const msg = (payload: GmailTeil, kopf: Record<string, string> = {}, extra: Partial<GmailNachricht> = {}): GmailNachricht => ({
  id: 'm1',
  internalDate: '1760000000000',
  payload: { ...payload, headers: [...(payload.headers ?? []), ...Object.entries(kopf).map(([name, value]) => ({ name, value }))] },
  ...extra,
});

describe('Base64url & Zeichensatz', () => {
  it('dekodiert base64url ohne Padding mit - und _', () => {
    const bytes = Buffer.from([0xfb, 0xff, 0xfe, 0x01]);
    expect(b64u(bytes)).toMatch(/[-_]/);
    expect(dekodiereBase64Url(b64u(bytes)).equals(bytes)).toBe(true);
    expect(dekodiereBase64Url(b64u('Hallo Welt')).toString()).toBe('Hallo Welt');
  });
  it('latin1 / windows-1252 / utf-8 / unbekannt', () => {
    const latin = Buffer.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]); // Müller in ISO-8859-1
    expect(dekodiereZeichensatz(latin, 'ISO-8859-1')).toBe('Müller');
    expect(dekodiereZeichensatz(latin, 'latin1')).toBe('Müller');
    expect(dekodiereZeichensatz(Buffer.from('Müller €'), 'utf-8')).toBe('Müller €');
    expect(dekodiereZeichensatz(Buffer.from([0x80]), 'windows-1252')).toBe('€');
    expect(dekodiereZeichensatz(Buffer.from('Grüße'), 'x-unbekannt')).toBe('Grüße');
    expect(dekodiereZeichensatz(Buffer.from('Grüße'), null)).toBe('Grüße');
  });
});

describe('extrahiereText', () => {
  it('einteilige text/plain-Nachricht', () => {
    expect(extrahiereText(teil('text/plain', 'Guten Tag\r\n\r\n\r\n\r\nDanke'))).toBe('Guten Tag\n\nDanke');
  });
  it('multipart/alternative: text/plain wird bevorzugt', () => {
    const p = multi('multipart/alternative', [teil('text/plain', 'Nur Text'), teil('text/html', '<p>Nur <b>HTML</b></p>')]);
    expect(extrahiereText(p)).toBe('Nur Text');
  });
  it('verschachtelt: mixed > alternative > plain, Anhang wird ignoriert', () => {
    const anhang: GmailTeil = { mimeType: 'application/pdf', filename: 'a.pdf', body: { attachmentId: 'x', size: 10 } };
    const p = multi('multipart/mixed', [multi('multipart/alternative', [teil('text/plain', 'Hallo'), teil('text/html', '<p>Hallo</p>')]), anhang]);
    expect(extrahiereText(p)).toBe('Hallo');
  });
  it('nur HTML: wird zu Text', () => {
    expect(extrahiereText(multi('multipart/alternative', [teil('text/html', '<div>Zeile 1<br>Zeile 2</div><p>Absatz</p>')]))).toBe('Zeile 1\nZeile 2\n\nAbsatz');
  });
  it('respektiert charset je Teil (latin1)', () => {
    const p = multi('multipart/alternative', [teil('text/plain', Buffer.from('Grüße aus Köln', 'latin1'), 'iso-8859-1')]);
    expect(extrahiereText(p)).toBe('Grüße aus Köln');
  });
  it('quoted-printable: Gmail liefert body.data schon dekodiert – kein zweites Dekodieren', () => {
    const t = teil('text/plain', 'Preis =3D 5 =C3=BC');
    t.headers!.push({ name: 'Content-Transfer-Encoding', value: 'quoted-printable' });
    expect(extrahiereText(t)).toBe('Preis =3D 5 =C3=BC');
  });
  it('leer / null', () => {
    expect(extrahiereText(null)).toBe('');
    expect(extrahiereText(multi('multipart/mixed', []))).toBe('');
  });
});

describe('htmlZuText', () => {
  it('entfernt Skripte, Styles, Kommentare und Tags, dekodiert Entities', () => {
    const h = '<html><head><title>T</title><style>p{color:red}</style></head><body><!-- c --><script>alert(1)</script><p>Preis: 5&nbsp;&euro; &amp; mehr &lt;b&gt; &#252; &#x00DF;</p></body></html>';
    const t = htmlZuText(h);
    expect(t).toBe('Preis: 5 € & mehr <b> ü ß');
    expect(t).not.toContain('alert');
    expect(t).not.toContain('color');
  });
  it('Listen, Zeilen- und Absatzumbrüche', () => {
    expect(htmlZuText('<ul><li>Eins</li><li>Zwei</li></ul><p>A</p><p>B<br/>C</p>')).toBe('- Eins\n- Zwei\n\nA\n\nB\nC');
  });
  it('blockquote wird zu „> “-Zeilen (schachtelungsfest)', () => {
    const t = htmlZuText('<div>Neu</div><div>Am 1. Okt. schrieb Max:</div><blockquote>Alt<blockquote>Älter</blockquote></blockquote>');
    expect(t).toContain('> Alt');
    expect(t).toMatch(/> > Älter|>\s*> Älter/);
  });
  it('Links und Bilder werden nicht übernommen (keine URLs, kein Laden)', () => {
    const t = htmlZuText('<a href="https://evil.example/x">Klick</a><img src="https://track.example/p.gif">');
    expect(t).toBe('Klick');
  });
  it('ungültige numerische Entities werden entfernt, unbekannte bleiben', () => {
    expect(dekodiereEntities('&#0; &#xD800; &unbekannt; &#99999999;')).toBe('  &unbekannt; ');
  });
});

describe('trenneVerlauf', () => {
  it('Am … schrieb …:', () => {
    const r = trenneVerlauf('Danke, gerne Dienstag.\n\nAm Mo., 5. Okt. 2026 um 10:00 Uhr schrieb Max <m@x.de>:\n> Hallo\n> Termin?');
    expect(r.neu).toBe('Danke, gerne Dienstag.');
    expect(r.zitat).toContain('Am Mo., 5. Okt.');
    expect(r.zitat).toContain('> Termin?');
  });
  it('umgebrochene Attribution (zwei Zeilen)', () => {
    const r = trenneVerlauf('Ja.\n\nAm Mo., 5. Okt. 2026 um 10:00 Uhr schrieb Maximilian Mustermann\n<m@x.de>:\n> Hallo');
    expect(r.neu).toBe('Ja.');
    expect(r.zitat).toContain('> Hallo');
  });
  it('On … wrote:', () => {
    const r = trenneVerlauf('Sounds good\n\nOn Mon, Oct 5, 2026 at 10:00 AM Max <m@x.de> wrote:\n> Hi');
    expect(r).toEqual({ neu: 'Sounds good', zitat: 'On Mon, Oct 5, 2026 at 10:00 AM Max <m@x.de> wrote:\n> Hi' });
  });
  it('Original-Nachricht-Trenner und Outlook-Kopf', () => {
    expect(trenneVerlauf('Hi\n\n-----Original Message-----\nFrom: a\nSent: b').neu).toBe('Hi');
    expect(trenneVerlauf('Hi\n\nVon: Max\nGesendet: Montag\nAn: ich\nBetreff: x\n\nText').neu).toBe('Hi');
  });
  it('nur „>“-Zeilen: werden herausgelöst, übriger Text bleibt', () => {
    const r = trenneVerlauf('> alt\nneu\n> alt2');
    expect(r).toEqual({ neu: 'neu', zitat: '> alt\n> alt2' });
  });
  it('kein Zitat: alles bleibt, „Am Montag“ im Fließtext ist kein Zitat', () => {
    const t = 'Am Montag passt es mir gut.\nGrüße';
    expect(trenneVerlauf(t)).toEqual({ neu: t, zitat: '' });
  });
});

describe('Adressen', () => {
  it('extrahiert die Adresse', () => {
    expect(extrahiereAdresse('"Max M." <Max@X.de>')).toBe('max@x.de');
    expect(extrahiereAdresse('max@x.de')).toBe('max@x.de');
    expect(extrahiereAdresse('Niemand')).toBe('');
  });
});

describe('parseNachricht / parseThread', () => {
  const eigen = 'amin@prozessia.de';
  it('füllt Felder, erkennt eigene Nachricht an Adresse bzw. SENT-Label', () => {
    const m = msg(teil('text/plain', 'Hallo\n\nAm 1. Okt. schrieb Amin <amin@prozessia.de>:\n> Video?'), {
      From: 'Max <max@kunde.de>',
      To: 'amin@prozessia.de',
      Subject: 'Re: Ihr Video',
      'Message-ID': '<abc@kunde.de>',
      References: '<erst@prozessia.de>',
    });
    const n = parseNachricht(m, eigen);
    expect(n).toMatchObject({ von: 'Max <max@kunde.de>', an: 'amin@prozessia.de', betreff: 'Re: Ihr Video', text: 'Hallo', eigene: false, datum: 1760000000000, messageId: '<abc@kunde.de>' });
    expect(n.zitat).toContain('> Video?');
    expect(parseNachricht(msg(teil('text/plain', 'x'), { From: '"Amin" <AMIN@prozessia.de>' }), eigen).eigene).toBe(true);
    expect(parseNachricht(msg(teil('text/plain', 'x'), { From: 'andere@x.de' }, { labelIds: ['SENT'] }), eigen).eigene).toBe(true);
  });
  it('Header-Injection: Zeilenumbrüche in Kopfzeilen werden entfernt', () => {
    const n = parseNachricht(msg(teil('text/plain', 'x'), { Subject: 'A\r\nBcc: x@y.de' }), eigen);
    expect(n.betreff).toBe('A Bcc: x@y.de');
  });
  it('sortiert nach Datum und liefert für die Anzeige keine internen Kopfzeilen', () => {
    const a = { ...msg(teil('text/plain', 'zweite'), { From: 'a@x.de' }), id: 'b', internalDate: '2000' };
    const b = { ...msg(teil('text/plain', 'erste'), { From: 'amin@prozessia.de' }), id: 'a', internalDate: '1000' };
    const t = parseThread([a, b], eigen);
    expect(t.map((x) => x.id)).toEqual(['a', 'b']);
    expect(Object.keys(fuerAnzeige(t[0])).sort()).toEqual(['an', 'betreff', 'datum', 'eigene', 'id', 'text', 'von', 'zitat']);
  });
  it('HTML-Inhalt bleibt Text: kein Markup in der Ausgabe', () => {
    const n = parseNachricht(msg(teil('text/html', '<p onclick="x()">Hi <img src=http://t.example/p.gif><script>1</script></p>')), eigen);
    expect(n.text).toBe('Hi');
  });
  it('sehr lange Texte werden gekürzt', () => {
    const n = parseNachricht(msg(teil('text/plain', 'a'.repeat(60_000))), eigen);
    expect(n.text.length).toBeLessThan(50_100);
    expect(n.text).toContain('Text gekürzt');
  });
});
