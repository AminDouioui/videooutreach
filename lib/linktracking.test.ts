import { describe, expect, it } from 'vitest';
import { erzeugeLinkToken, pruefeLinkToken, trackeHtml, trackeText } from './linktracking';
import { buildEmail, escapeHtml } from './mail';
import { isPublicPath } from './auth';

const K = 'a'.repeat(64);
const APP = 'https://video.example.de';

describe('Link-Token', () => {
  it('stabil je Lead+URL, verschieden je Lead und je URL', () => {
    const a = erzeugeLinkToken(K, 'lead-1', 'https://x.de/a?b=1&c=2');
    expect(a).toBe(erzeugeLinkToken(K, 'lead-1', 'https://x.de/a?b=1&c=2'));
    expect(a).not.toBe(erzeugeLinkToken(K, 'lead-2', 'https://x.de/a?b=1&c=2'));
    expect(a).not.toBe(erzeugeLinkToken(K, 'lead-1', 'https://x.de/b'));
    expect(a).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
  });
  it('Roundtrip liefert Slug und URL', () => {
    const t = erzeugeLinkToken(K, 'lead-1', 'https://x.de/ä?q=ü')!;
    expect(pruefeLinkToken(K, t)).toEqual({ slug: 'lead-1', url: 'https://x.de/ä?q=ü' });
  });
  it('lehnt falschen Schlüssel, Manipulation, Müll und fremde Signatur ab', () => {
    const t = erzeugeLinkToken(K, 'lead-1', 'https://x.de/a')!;
    expect(pruefeLinkToken('b'.repeat(64), t)).toBeNull();
    const [daten, sig] = t.split('.');
    const fremd = Buffer.from('lead-1\nhttps://boese.de/', 'utf8').toString('base64url');
    expect(pruefeLinkToken(K, `${fremd}.${sig}`)).toBeNull(); // andere URL, alte Signatur
    const anderer = Buffer.from('lead-2\nhttps://x.de/a', 'utf8').toString('base64url');
    expect(pruefeLinkToken(K, `${anderer}.${sig}`)).toBeNull(); // anderer Lead
    expect(pruefeLinkToken(K, `${daten}.${'A'.repeat(22)}`)).toBeNull();
    for (const x of ['', 'abc', '.', 'a.b', `${daten}`, `${daten}.${sig}x`, '../../etc']) expect(pruefeLinkToken(K, x)).toBeNull();
  });
  it('nur http(s): kein javascript:, data:, mailto:, relative oder zu lange URLs', () => {
    for (const u of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.de', '/relativ', 'ftp://x.de', 'https://x.de/a b', 'https://x.de/' + 'a'.repeat(1600)]) {
      expect(erzeugeLinkToken(K, 'lead-1', u)).toBeNull();
    }
    expect(erzeugeLinkToken('', 'lead-1', 'https://x.de')).toBeNull();
    // selbst ein korrekt signiertes javascript:-Token wird beim Prüfen abgelehnt
    const roh = Buffer.from('lead-1\njavascript:alert(1)', 'utf8').toString('base64url');
    expect(pruefeLinkToken(K, `${roh}.${'A'.repeat(22)}`)).toBeNull();
  });
  it('/api/c/ ist öffentlich', () => {
    expect(isPublicPath('/api/c/abc.def')).toBe(true);
    expect(isPublicPath('/api/cx')).toBe(false);
  });
});

describe('Umschreiben', () => {
  const o = { appUrl: APP, schluessel: K, slug: 'lead-1' };
  const tok = (u: string) => `${APP}/api/c/${erzeugeLinkToken(K, 'lead-1', u)}`;

  it('Klartext: Links ersetzen, Satzzeichen am Ende bleiben, Ausnahmen und mailto bleiben', () => {
    const t = trackeText(`Siehe https://x.de/a?b=1&c=2. Oder (https://y.de/p), mailto:a@b.de, ${APP}/v/slug, ${APP}/abmelden/slug, ${APP}/media/slug.jpg`, o);
    expect(t).toContain(`Siehe ${tok('https://x.de/a?b=1&c=2')}.`);
    expect(t).toContain(`(${tok('https://y.de/p')}),`);
    expect(t).toContain(`mailto:a@b.de, ${APP}/v/slug, ${APP}/abmelden/slug, ${APP}/media/slug.jpg`);
  });
  it('Vorschau-Modus hängt ?vorschau=1 an', () => {
    expect(trackeText('https://x.de', { ...o, vorschau: true })).toBe(`${tok('https://x.de')}?vorschau=1`);
  });
  it('HTML: Link mit getrackter Adresse, sichtbarer Text bleibt, Escaping stimmt', () => {
    const h = trackeHtml(escapeHtml('Hier: https://x.de/a?b=1&c="2" Ende.'), escapeHtml, o);
    // " beendet die URL; & wird zu &amp; im sichtbaren Text, im Ziel ist es das echte &
    expect(h).toBe(`Hier: <a href="${tok('https://x.de/a?b=1&c=')}">https://x.de/a?b=1&amp;c=</a>&quot;2&quot; Ende.`);
    const h2 = trackeHtml(escapeHtml('Link: https://x.de/a?b=1&c=2.'), escapeHtml, o);
    expect(h2).toContain(`href="${tok('https://x.de/a?b=1&c=2')}">https://x.de/a?b=1&amp;c=2</a>.`);
    expect(h2).not.toContain('&amp;amp;');
  });
  it('HTML: mehrfach dieselbe URL = dasselbe Token', () => {
    const h = trackeHtml('https://x.de/a und https://x.de/a', escapeHtml, o);
    const hrefs = [...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toHaveLength(2);
    expect(hrefs[0]).toBe(hrefs[1]);
  });
});

describe('buildEmail mit linkTracking', () => {
  const lead = { slug: 'muster-1', firma: 'Muster & Co', website: 'https://muster.de/start?x=1&y=2' };
  const settings = { appUrl: APP, signature: 'Gruß\nhttps://sig.de', linkSchluessel: K };
  const kampagne = { emailSubjectTemplate: 'Hallo {{firma}}', emailBodyTemplate: 'Hi,\n\n{{vorschaubild}}\n\nUnsere Seite: {{website}} und {{video_link}} und https://cal.com/x.\n\nMail: mailto:a@b.de', trackingPixel: true };

  it('aus (Standard): Mail unverändert', () => {
    const m = buildEmail(lead, kampagne, settings);
    expect(m.html).not.toContain('/api/c/');
    expect(m.text).not.toContain('/api/c/');
    expect(m.html).not.toContain('<a href="https://cal.com');
  });
  it('ohne Schlüssel: keine Umleitung', () => {
    expect(buildEmail(lead, { ...kampagne, linkTracking: true }, { ...settings, linkSchluessel: undefined }).html).not.toContain('/api/c/');
  });
  it('an: HTML und Text umgeleitet, Ausnahmen bleiben', () => {
    const m = buildEmail(lead, { ...kampagne, linkTracking: true }, settings);
    const web = erzeugeLinkToken(K, 'muster-1', 'https://muster.de/start?x=1&y=2')!;
    const cal = erzeugeLinkToken(K, 'muster-1', 'https://cal.com/x')!;
    expect(m.html).toContain(`<a href="${APP}/api/c/${web}">https://muster.de/start?x=1&amp;y=2</a>`);
    expect(m.html).toContain(`<a href="${APP}/api/c/${cal}">https://cal.com/x</a>.`);
    expect(m.text).toContain(`${APP}/api/c/${web}`);
    expect(m.text).toContain(`${APP}/api/c/${cal}.`);
    // Video-Link, Vorschaubild, Abmeldung, Signatur, Pixel unverändert
    expect(m.html).toContain(`<a href="${APP}/v/muster-1"><img`);
    expect(m.html).toContain(`und ${APP}/v/muster-1 und`);
    expect(m.html).toContain(`<a href="${APP}/abmelden/muster-1"`);
    expect(m.html).toContain('src="https://video.example.de/api/o/muster-1.gif"');
    expect(m.html).toContain('https://sig.de');
    expect(m.text).toContain('Video ansehen: ' + APP + '/v/muster-1');
    expect(m.text).toContain('mailto:a@b.de');
    expect(m.text).toContain('-- \nGruß\nhttps://sig.de');
    expect(m.html).not.toContain('mailto:a@b.de</a>');
    expect(m.html).not.toContain('<a href="mailto');
  });
  it('Vorlagen-HTML wird weiter escaped (kein Einschleusen von Tags oder Attributen)', () => {
    const m = buildEmail(lead, { ...kampagne, linkTracking: true, emailBodyTemplate: '<a href="https://boese.de">x</a> https://ok.de/"onmouseover="x' }, settings);
    expect(m.html).not.toContain('<a href="https://boese.de">');
    expect(m.html).not.toMatch(/"onmouseover=/);
    expect(m.html).toContain('&lt;a href=&quot;');
  });
  it('Lead-Werte mit Anführungszeichen können das href-Attribut nicht verlassen', () => {
    const m = buildEmail({ ...lead, website: 'https://x.de/"><script>alert(1)</script>' }, { ...kampagne, linkTracking: true, emailBodyTemplate: '{{website}}' }, settings);
    expect(m.html).not.toContain('<script>');
  });
  it('Vorschau-Modus: ?vorschau=1', () => {
    const m = buildEmail(lead, { ...kampagne, linkTracking: true }, { ...settings, vorschau: true });
    expect(m.html).toMatch(/href="[^"]*\/api\/c\/[^"]+\?vorschau=1"/);
    expect(m.text).toMatch(/\/api\/c\/\S+\?vorschau=1/);
  });
});
