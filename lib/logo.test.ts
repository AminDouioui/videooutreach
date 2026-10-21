import { describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES, logoUrlAusExtra, pruefeLogoAdresse, pruefeLogoErreichbar, type LogoFetch } from './logo';
import { ctaOrtAusMeta, zeigeZweitenCta } from './video-cta';

describe('Logo-Adresse', () => {
  it('nimmt nur https mit öffentlichem Hostnamen', () => {
    expect(pruefeLogoAdresse('https://firma.de/logo.png')).toBe('https://firma.de/logo.png');
    for (const schlecht of ['http://firma.de/l.png', 'ftp://firma.de/l.png', 'https://localhost/l.png', 'https://127.0.0.1/l.png', 'https://10.0.0.5/l.png', 'https://[::1]/l.png', 'https://intern/l.png', 'https://server.local/l.png', 'https://user:pw@firma.de/l.png', 'javascript:alert(1)', 'kein url', '']) {
      expect(pruefeLogoAdresse(schlecht), schlecht).toBeNull();
    }
  });
  it('liest das Logo aus den Zusatzspalten (Spaltenname egal in Groß/Klein)', () => {
    expect(logoUrlAusExtra({ Branche: 'x' })).toBeNull();
    expect(logoUrlAusExtra({ logo: 'https://firma.de/l.png' })).toBe('https://firma.de/l.png');
    expect(logoUrlAusExtra({ LOGO_URL: 'https://firma.de/l.png' })).toBe('https://firma.de/l.png');
    expect(logoUrlAusExtra({ 'Logo URL': 'https://firma.de/l.png' })).toBe('https://firma.de/l.png');
    expect(logoUrlAusExtra({ logo: 'http://unsicher.de/l.png' })).toBeNull();
    expect(logoUrlAusExtra(null)).toBeNull();
  });
});

const antwort = (o: { ok?: boolean; url?: string; typ?: string; laenge?: string; bytes?: number }): LogoFetch => async (url) => ({
  ok: o.ok ?? true,
  url: o.url ?? url,
  headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? (o.typ ?? 'image/png') : n.toLowerCase() === 'content-length' ? (o.laenge ?? null) : null) },
  arrayBuffer: async () => new ArrayBuffer(o.bytes ?? 1000),
});

describe('Logo erreichbar', () => {
  const url = 'https://firma.de/l.png';
  it('akzeptiert ein kleines Bild', async () => {
    expect(await pruefeLogoErreichbar(url, antwort({}))).toBe(url);
  });
  it('lehnt Nicht-Bilder, zu große, leere und fehlerhafte Antworten ab', async () => {
    expect(await pruefeLogoErreichbar(url, antwort({ typ: 'text/html' }))).toBeNull();
    expect(await pruefeLogoErreichbar(url, antwort({ laenge: String(LOGO_MAX_BYTES + 1) }))).toBeNull();
    expect(await pruefeLogoErreichbar(url, antwort({ bytes: LOGO_MAX_BYTES + 1 }))).toBeNull();
    expect(await pruefeLogoErreichbar(url, antwort({ bytes: 0 }))).toBeNull();
    expect(await pruefeLogoErreichbar(url, antwort({ ok: false }))).toBeNull();
  });
  it('lehnt eine Weiterleitung auf eine interne Adresse ab und fängt Netzfehler ab', async () => {
    expect(await pruefeLogoErreichbar(url, antwort({ url: 'https://127.0.0.1/l.png' }))).toBeNull();
    expect(await pruefeLogoErreichbar(url, async () => { throw new Error('ENOTFOUND'); })).toBeNull();
    expect(await pruefeLogoErreichbar('http://firma.de/l.png', antwort({}))).toBeNull();
    expect(await pruefeLogoErreichbar('', antwort({}))).toBeNull();
  });
  it('bricht nach dem Zeitlimit ab', async () => {
    const haengt: LogoFetch = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort'))));
    expect(await pruefeLogoErreichbar(url, haengt, 20)).toBeNull();
  });
});

describe('Zweiter Termin-Button', () => {
  it('erscheint ab der Hälfte oder am Ende', () => {
    expect(zeigeZweitenCta(0.49)).toBe(false);
    expect(zeigeZweitenCta(0.5)).toBe(true);
    expect(zeigeZweitenCta(0.1, true)).toBe(true);
    expect(zeigeZweitenCta(NaN)).toBe(false);
  });
  it('Ort aus dem Event, Altbestand zählt als unten', () => {
    expect(ctaOrtAusMeta({ ort: 'video_50' })).toBe('video_50');
    expect(ctaOrtAusMeta({ ort: 'unten' })).toBe('unten');
    expect(ctaOrtAusMeta(null)).toBe('unten');
    expect(ctaOrtAusMeta({ ort: 'sonstwas' })).toBe('unten');
  });
});
