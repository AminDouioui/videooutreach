import { describe, expect, it } from 'vitest';
import { buildEmail, buildMime, buildMimeText, encodeHeaderWord, escapeHtml, renderTemplate } from './mail';

const lead = { slug: 'musterbau-k7f3', firma: 'Müller & Söhne <GmbH>', vorname: 'Max', nachname: 'Mustermann', renderedAt: new Date(1700000000000) };
const kampagne = {
  emailSubjectTemplate: 'Kurzes Video für {{firma}}',
  emailBodyTemplate: '{{begruessung}},\n\nich habe für {{firma}} ein Video:\n\n{{vorschaubild}}\n\nBis bald\nzweite Zeile',
  trackingPixel: false,
};
const settings = { appUrl: 'https://video.example.de', signature: 'Amin Douioui\nProzessia\nTel: 0123' };

describe('renderTemplate', () => {
  it('ersetzt Platzhalter, auch mit Leerzeichen, und lässt Unbekanntes stehen', () => {
    expect(renderTemplate('Hi {{ vorname }} {{nachname}} {{foo}}', { vorname: 'A', nachname: 'B' })).toBe('Hi A B {{foo}}');
  });
});

describe('buildEmail', () => {
  const m = buildEmail(lead, kampagne, settings);
  it('Betreff', () => expect(m.subject).toBe('Kurzes Video für Müller & Söhne <GmbH>'));
  it('HTML escaped Werte', () => {
    expect(m.html).toContain('Müller &amp; Söhne &lt;GmbH&gt;');
    expect(m.html).not.toContain('<GmbH>');
  });
  it('Begrüßung, Vorschaubild verlinkt, Textlink', () => {
    expect(m.html).toContain('Guten Tag Max Mustermann,');
    expect(m.html).toContain('<a href="https://video.example.de/v/musterbau-k7f3"><img src="https://video.example.de/media/musterbau-k7f3.jpg?v=1700000000000"');
    expect(m.html).toContain('width="320"');
    expect(m.html).toContain('>Video ansehen: https://video.example.de/v/musterbau-k7f3</a>');
  });
  it('Signatur mit Zeilenumbrüchen, Abmeldezeile', () => {
    expect(m.html).toContain('Amin Douioui<br>Prozessia<br>Tel: 0123');
    expect(m.html).toContain('href="https://video.example.de/abmelden/musterbau-k7f3"');
    expect(m.html).toContain('Bis bald<br>zweite Zeile');
  });
  it('Klartext', () => {
    expect(m.text).toContain('Video ansehen: https://video.example.de/v/musterbau-k7f3');
    expect(m.text).toContain('Amin Douioui\nProzessia');
    expect(m.text).toContain('Hier abmelden: https://video.example.de/abmelden/musterbau-k7f3');
    expect(m.text).not.toContain('<a ');
  });
  it('Pixel nur bei tracking_pixel', () => {
    expect(m.html).not.toContain('/api/o/');
    const p = buildEmail(lead, { ...kampagne, trackingPixel: true }, settings);
    expect(p.html).toContain('https://video.example.de/api/o/musterbau-k7f3.gif');
  });
  it('ohne Namen nur „Guten Tag“, Betreff ohne Zeilenumbruch', () => {
    const x = buildEmail({ ...lead, vorname: null, nachname: null }, { ...kampagne, emailSubjectTemplate: 'A\r\nBcc: x@y.de' }, settings);
    expect(x.text.startsWith('Guten Tag,')).toBe(true);
    expect(x.subject).not.toMatch(/[\r\n]/);
  });
  it('HTML-Injection im Template wird escaped', () => {
    const x = buildEmail(lead, { ...kampagne, emailBodyTemplate: '<script>alert(1)</script> {{vorschaubild}}' }, settings);
    expect(x.html).not.toContain('<script>');
  });
});

// Minimaler MIME-Parser für den Test
function parse(raw: string) {
  const [kopf, ...rest] = raw.split('\r\n\r\n');
  const headers: Record<string, string> = {};
  for (const zeile of kopf.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const i = zeile.indexOf(':');
    headers[zeile.slice(0, i).toLowerCase()] = zeile.slice(i + 1).trim();
  }
  return { headers, body: rest.join('\r\n\r\n') };
}

describe('buildMime', () => {
  const email = buildEmail(lead, kampagne, settings);
  const opts = {
    from: { name: 'Amin Douioui', email: 'Amin.douioui@prozessia.de' },
    to: 'max@firma.de',
    subject: 'Kurzes Video für Müller',
    html: email.html,
    text: email.text,
    listUnsubscribeUrl: 'https://video.example.de/api/unsubscribe/musterbau-k7f3',
    listUnsubscribeMailto: 'mailto:Amin.douioui@prozessia.de?subject=Abmelden',
    boundary: 'BOUNDARY',
    messageId: '<abc123@prozessia.de>',
    date: new Date('2026-07-15T08:00:00Z'),
  };
  const raw = buildMimeText(opts);
  const { headers, body } = parse(raw);

  it('Header', () => {
    expect(headers['from']).toBe('"Amin Douioui" <Amin.douioui@prozessia.de>');
    expect(headers['to']).toBe('max@firma.de');
    expect(headers['mime-version']).toBe('1.0');
    expect(headers['content-type']).toBe('multipart/alternative; boundary="BOUNDARY"');
    expect(headers['list-unsubscribe']).toBe('<https://video.example.de/api/unsubscribe/musterbau-k7f3>, <mailto:Amin.douioui@prozessia.de?subject=Abmelden>');
    expect(headers['list-unsubscribe-post']).toBe('List-Unsubscribe=One-Click');
    expect(headers['date']).toBe('Wed, 15 Jul 2026 08:00:00 +0000');
    expect(headers['message-id']).toBe("<abc123@prozessia.de>");
  });
  it('Betreff RFC 2047 dekodierbar', () => {
    const w = headers['subject'].match(/=\?UTF-8\?B\?([^?]+)\?=/g) ?? [];
    expect(w.length).toBeGreaterThan(0);
    const dec = w.map((x) => Buffer.from(x.replace(/=\?UTF-8\?B\?|\?=/g, ''), 'base64').toString('utf8')).join('');
    expect(dec).toBe('Kurzes Video für Müller');
  });
  it('zwei Teile text/plain + text/html, Endboundary, kein Anhang', () => {
    const teile = body.split('--BOUNDARY').slice(1);
    expect(teile.at(-1)?.trim()).toBe('--');
    const echte = teile.slice(0, -1);
    expect(echte).toHaveLength(2);
    const [t, h] = echte.map((p) => {
      const parsed = parse(p.replace(/^\r\n/, ''));
      return { ct: parsed.headers['content-type'], text: Buffer.from(parsed.body.replace(/\s+/g, ''), 'base64').toString('utf8') };
    });
    expect(t.ct).toContain('text/plain');
    expect(h.ct).toContain('text/html');
    expect(t.text).toBe(email.text);
    expect(h.text).toBe(email.html);
    expect(raw).not.toMatch(/Content-Disposition/i);
    expect(raw).not.toMatch(/multipart\/mixed/i);
  });
  it('base64url ohne +/= und dekodierbar', () => {
    const b = buildMime(opts);
    expect(b).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(b, 'base64url').toString('utf8')).toBe(raw);
  });
  it('Anzeigename mit Umlaut wird encoded; Zeilenumbrüche im Betreff entfernt', () => {
    const r = buildMimeText({ ...opts, from: { name: 'Jörg', email: 'a@b.de' }, subject: 'x\r\nBcc: evil@x.de' });
    expect(r).toContain('=?UTF-8?B?');
    expect(r).not.toMatch(/\r\nBcc:/);
  });
});

describe('Helfer', () => {
  it('escapeHtml', () => expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;'));
  it('encodeHeaderWord ASCII unverändert, lang wird geteilt', () => {
    expect(encodeHeaderWord('Hallo')).toBe('Hallo');
    expect(encodeHeaderWord('ü'.repeat(60)).split('\r\n ').length).toBeGreaterThan(1);
  });
});

describe('renderTemplate: Fallbacks', () => {
  it('nimmt den Fallback bei leerem oder unbekanntem Wert', () => {
    expect(renderTemplate('{{vorname|Hallo zusammen}}', { vorname: '' })).toBe('Hallo zusammen');
    expect(renderTemplate('{{ vorname | Hallo zusammen }}', { vorname: 'Max' })).toBe('Max');
    expect(renderTemplate('{{stadt|dort}} {{foo}}', {})).toBe('dort {{foo}}');
  });
});

describe('buildEmail: Spintax, Variablen, Fallbacks', () => {
  const k = (betreff: string, text: string) => ({ ...kampagne, emailSubjectTemplate: betreff, emailBodyTemplate: text });
  it('Spintax ist deterministisch und gilt in HTML und Klartext gleich', () => {
    const x = buildEmail(lead, k('{A|B|C} {{firma}}', '{Hallo|Moin|Servus} Welt'), settings);
    const y = buildEmail(lead, k('{A|B|C} {{firma}}', '{Hallo|Moin|Servus} Welt'), settings);
    expect(x).toEqual(y);
    const wort = /(Hallo|Moin|Servus)/.exec(x.text)![1];
    expect(x.html).toContain(wort);
  });
  it('Follow-up-Betreff entspricht dem Erstbetreff, auch bei Spintax', () => {
    const vorlage = k('{Eins|Zwei|Drei|Vier|Fünf|Sechs} für {{firma}}', 'x');
    for (let i = 0; i < 20; i++) {
      const l = { ...lead, slug: `lead-${i}` };
      const erst = buildEmail(l, vorlage, settings);
      const f1 = buildEmail(l, vorlage, settings, { body: 'Hi', nr: 1 });
      const f2 = buildEmail(l, vorlage, settings, { body: 'Hi', nr: 2 });
      expect(f1.subject).toBe(`Re: ${erst.subject}`);
      expect(f2.subject).toBe(f1.subject);
    }
  });
  it('Lead-Werte mit {a|b} bleiben wörtlich', () => {
    const l = { ...lead, firma: 'Foo {a|b} GmbH', vorname: '{x|y}', extra: { Notiz: '{p|q}' } };
    const x = buildEmail(l, k('{{firma}} {{notiz}}', '{{vorname}} {{firma}} {{notiz}}'), settings);
    expect(x.subject).toBe('Foo {a|b} GmbH {p|q}');
    expect(x.text).toContain('{x|y} Foo {a|b} GmbH {p|q}');
    expect(x.html).toContain('{x|y} Foo {a|b} GmbH {p|q}');
  });
  it('Extra-Spalten, Position, Website, E-Mail, Absendername', () => {
    const l = { ...lead, position: 'GF', website: 'https://m.de', email: 'a@b.de', extra: { 'Stadt (PLZ)': 'Köln 50667', Größe: '' } };
    const x = buildEmail(l, k('s', '{{position}}|{{website}}|{{email}}|{{absender_name}}|{{stadt_plz}}|{{groesse|klein}}'), { ...settings, senderName: 'Amin' });
    expect(x.text).toContain('GF|https://m.de|a@b.de|Amin|Köln 50667|klein');
  });
  it('Fallback und fehlende Extra-Spalte der Kampagne', () => {
    const x = buildEmail({ ...lead, vorname: null }, { ...k('s', '{{vorname|Hallo zusammen}} {{stadt}}|{{stadt|dort}}'), extraSpalten: ['stadt'] }, settings);
    expect(x.text).toContain('Hallo zusammen |dort');
  });
  it('Spintax und Platzhalter mit Fallback zusammen', () => {
    const x = buildEmail({ ...lead, vorname: null }, k('s', '{Hi {{vorname|du}}|Hallo {{vorname|du}}}'), settings);
    expect(x.text).toMatch(/^(Hi|Hallo) du/);
  });
});
