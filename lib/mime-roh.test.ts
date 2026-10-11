import { describe, expect, it } from 'vitest';
import { buildMimeText } from './mail';
import { parseThread } from './mail-parse';
import { decodeQuotedPrintable, dekodiereEncodedWords, kopfAusRoh, parseKopfzeilen, parseRohnachricht, rohZuNachricht } from './mime-roh';

const b = (s: string) => Buffer.from(s, 'utf8');

describe('Kopfzeilen', () => {
  it('entfaltet Fortsetzungszeilen und dekodiert encoded-words (B und Q, mehrteilig)', () => {
    const kopf = parseKopfzeilen('Subject: =?UTF-8?B?QW50d29ydCDDvGJlciBNw7xsbGVy?=\r\n =?UTF-8?Q?_=C3=A4?=\r\nFrom: =?ISO-8859-1?Q?J=FCrgen?= <j@x.de>\r\nReferences: <a@x.de>\r\n <b@x.de>');
    expect(kopf[0].wert).toBe('Antwort über Müller ä');
    expect(kopf[1].wert).toBe('Jürgen <j@x.de>');
    expect(kopf[2].wert).toBe('<a@x.de> <b@x.de>');
  });
  it('kopfAusRoh liefert kleingeschriebene Namen; References/In-Reply-To doppelt werden zusammengefügt', () => {
    const m = kopfAusRoh(b('Message-ID: <1@x.de>\r\nReferences: <a@x.de>\r\nReferences: <b@x.de>\r\nSubject: Hi\r\n\r\nText'));
    expect(m['message-id']).toBe('<1@x.de>');
    expect(m['references']).toBe('<a@x.de> <b@x.de>');
  });
  it('encoded-word-Helfer und quoted-printable', () => {
    expect(dekodiereEncodedWords('=?utf-8?q?Gr=C3=BC=C3=9Fe?=')).toBe('Grüße');
    expect(decodeQuotedPrintable('Gr=C3=BC=C3=9Fe=\r\n und mehr').toString('utf8')).toBe('Grüße und mehr');
  });
});

describe('MIME-Baum', () => {
  it('liest die von der App gebaute Mail (multipart/alternative, base64) unverändert zurück', () => {
    const roh = buildMimeText({
      from: { name: 'Amin Müller', email: 'amin@prozessia.de' },
      to: 'k@kunde.de',
      subject: 'Grüße aus Köln',
      html: '<p>Hallo <b>Welt</b></p>',
      text: 'Hallo Welt, schöne Grüße',
      listUnsubscribeUrl: 'https://x.de/u',
      listUnsubscribeMailto: 'mailto:amin@prozessia.de',
      messageId: '<abc@prozessia.de>',
      inReplyTo: '<erst@prozessia.de>',
    });
    const teil = parseRohnachricht(b(roh));
    expect(teil.mimeType).toBe('multipart/alternative');
    expect(teil.parts).toHaveLength(2);
    const [txt] = parseThread([{ id: '1', payload: teil, internalDate: '1000' }], 'amin@prozessia.de');
    expect(txt.text).toBe('Hallo Welt, schöne Grüße');
    expect(txt.betreff).toBe('Grüße aus Köln');
    expect(txt.eigene).toBe(true);
    expect(txt.messageId).toBe('<abc@prozessia.de>');
  });
  it('quoted-printable, Zeichensatz ISO-8859-1 und Zitat-Abtrennung', () => {
    const roh = ['From: Kunde <k@kunde.de>', 'To: amin@prozessia.de', 'Subject: Re: Hallo', 'Message-ID: <r1@kunde.de>', 'Content-Type: text/plain; charset=ISO-8859-1', 'Content-Transfer-Encoding: quoted-printable', '', 'Gern, ich melde mich n=E4chste Woche.', '', 'Am 15.07.2026 schrieb Amin:', '> Hallo', ''].join('\r\n');
    const [n] = parseThread([rohZuNachricht(b(roh), { id: 'x', datum: 5, gesendet: false })], 'amin@prozessia.de');
    expect(n.text).toBe('Gern, ich melde mich nächste Woche.');
    expect(n.zitat).toContain('> Hallo');
    expect(n.eigene).toBe(false);
    expect(n.datum).toBe(5);
  });
  it('verschachtelt: mixed → alternative, Anhang wird ignoriert, nur HTML wird zu Text', () => {
    const roh = [
      'From: k@kunde.de',
      'Subject: Mit Anhang',
      'Content-Type: multipart/mixed; boundary="AAA"',
      '',
      '--AAA',
      'Content-Type: multipart/alternative; boundary="BBB"',
      '',
      '--BBB',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('<p>Hallo<br>Welt</p>').toString('base64'),
      '--BBB--',
      '--AAA',
      'Content-Type: application/pdf; name="a.pdf"',
      'Content-Disposition: attachment; filename="a.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0=',
      '--AAA--',
      '',
    ].join('\n');
    const teil = parseRohnachricht(b(roh));
    expect(teil.parts?.[1].filename).toBe('a.pdf');
    expect(teil.parts?.[1].body).toBeUndefined();
    const [n] = parseThread([{ id: '1', payload: teil }], 'amin@prozessia.de');
    expect(n.text).toBe('Hallo\nWelt');
  });
  it('einteilige Mail ohne Content-Type und kaputte/fehlende Grenzen stürzen nicht ab', () => {
    const [n] = parseThread([rohZuNachricht(b('From: a@b.de\r\nSubject: x\r\n\r\nNur Text'), { id: '1', datum: null, gesendet: false })], 'amin@prozessia.de');
    expect(n.text).toBe('Nur Text');
    expect(() => parseRohnachricht(b('Content-Type: multipart/mixed; boundary="Z"\r\n\r\n--Z\r\nContent-Type: text/plain\r\n\r\nohne Ende'))).not.toThrow();
    expect(() => parseRohnachricht(b(''))).not.toThrow();
  });
});
