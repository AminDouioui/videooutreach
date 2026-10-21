import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  anzeigeHost,
  erlaubeAnfrage,
  findeRemotionBrowser,
  istOeffentlicheIp,
  istOeffentlicherHost,
  macheWebsiteScreenshot,
  normalisiereWebsite,
  screenshotCachePfad,
  websiteScreenshotDataUri,
} from './website-screenshot';

describe('Adressen normalisieren', () => {
  it('ergänzt https, übernimmt http, lehnt Gefährliches ab', () => {
    expect(normalisiereWebsite('firma.de')).toBe('https://firma.de/');
    expect(normalisiereWebsite('www.firma.de/start')).toBe('https://www.firma.de/start');
    expect(normalisiereWebsite('http://firma.de')).toBe('http://firma.de/');
    for (const schlecht of ['', '   ', 'ftp://firma.de', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@firma.de', 'https://firma.de:8080', 'https://intern', 'firma de', null, undefined]) {
      expect(normalisiereWebsite(schlecht as string), String(schlecht)).toBeNull();
    }
  });
  it('anzeigeHost entfernt www', () => {
    expect(anzeigeHost('https://www.firma.de/x')).toBe('firma.de');
    expect(anzeigeHost('kaputt')).toBe('');
  });
});

describe('IP-Prüfung', () => {
  it('öffentliche Adressen sind erlaubt', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e']) expect(istOeffentlicheIp(ip), ip).toBe(true);
  });
  it('private, lokale und reservierte Adressen sind gesperrt', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1', '203.0.113.5', '::1', '::', 'fe80::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::192.168.0.1', 'kein-ip', '']) {
      expect(istOeffentlicheIp(ip), ip).toBe(false);
    }
    expect(istOeffentlicheIp('::ffff:8.8.8.8')).toBe(true);
    expect(istOeffentlicheIp('172.15.0.1')).toBe(true);
    expect(istOeffentlicheIp('172.32.0.1')).toBe(true);
  });
  it('Host: alle aufgelösten Adressen müssen öffentlich sein', async () => {
    expect(await istOeffentlicherHost('firma.de', async () => ['93.184.216.34'])).toBe(true);
    expect(await istOeffentlicherHost('firma.de', async () => ['93.184.216.34', '10.0.0.1'])).toBe(false); // gemischt
    expect(await istOeffentlicherHost('firma.de', async () => [])).toBe(false);
    expect(await istOeffentlicherHost('firma.de', async () => { throw new Error('ENOTFOUND'); })).toBe(false);
    expect(await istOeffentlicherHost('localhost', async () => ['8.8.8.8'])).toBe(false);
    expect(await istOeffentlicherHost('db.internal', async () => ['8.8.8.8'])).toBe(false);
    expect(await istOeffentlicherHost('127.0.0.1')).toBe(false);
    expect(await istOeffentlicherHost('[::1]')).toBe(false);
    expect(await istOeffentlicherHost('8.8.8.8')).toBe(true);
  });
  it('Anfragen: Schema, Port und Host werden geprüft', async () => {
    const oeffentlich = async () => ['93.184.216.34'];
    expect(await erlaubeAnfrage('https://firma.de/a.js', oeffentlich)).toBe(true);
    expect(await erlaubeAnfrage('http://firma.de:80/a', oeffentlich)).toBe(true);
    expect(await erlaubeAnfrage('data:image/png;base64,AAAA', oeffentlich)).toBe(true);
    expect(await erlaubeAnfrage('about:blank', oeffentlich)).toBe(true);
    expect(await erlaubeAnfrage('file:///etc/passwd', oeffentlich)).toBe(false);
    expect(await erlaubeAnfrage('ftp://firma.de/x', oeffentlich)).toBe(false);
    expect(await erlaubeAnfrage('https://firma.de:8443/x', oeffentlich)).toBe(false);
    expect(await erlaubeAnfrage('http://169.254.169.254/latest/meta-data', oeffentlich)).toBe(false);
    expect(await erlaubeAnfrage('https://intern.firma.de/', async () => ['192.168.0.9'])).toBe(false);
    expect(await erlaubeAnfrage('kein url', oeffentlich)).toBe(false);
  });
});

describe('Cache und Data-URI', () => {
  it('liefert aus dem Cache, ohne Browser, und lehnt abgelaufenen Cache ohne Browser ab', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-shot-'));
    const url = 'https://firma.de/';
    const datei = screenshotCachePfad(dir, url);
    fs.mkdirSync(path.dirname(datei), { recursive: true });
    fs.writeFileSync(datei, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const r = await websiteScreenshotDataUri('firma.de', dir, null);
    expect(r?.dataUri).toBe(`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`);
    expect(r?.host).toBe('firma.de');
    expect(await websiteScreenshotDataUri('firma.de', dir, null, Date.now() + 8 * 24 * 3600_000)).toBeNull(); // älter als 7 Tage, kein Browser
    expect(await websiteScreenshotDataUri('ungültig://x', dir, null)).toBeNull();
    expect(await websiteScreenshotDataUri(null, dir, null)).toBeNull();
  });
  it('findeRemotionBrowser sucht in node_modules/.remotion', () => {
    const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-rb-'));
    expect(findeRemotionBrowser(wurzel)).toBeNull();
    const ziel = path.join(wurzel, 'node_modules', '.remotion', 'chrome-headless-shell', 'linux64', 'chrome-headless-shell-linux64');
    fs.mkdirSync(ziel, { recursive: true });
    fs.writeFileSync(path.join(ziel, 'chrome-headless-shell'), '');
    expect(findeRemotionBrowser(wurzel)).toBe(path.join(ziel, 'chrome-headless-shell'));
  });
});

// Echter Browser: nur, wenn eine Chromium-Binärdatei vorhanden ist (REMOTION_BROWSER_EXECUTABLE oder Remotion-Download oder Playwright-Cache)
function browserPfad(): string | null {
  const env = process.env.REMOTION_BROWSER_EXECUTABLE;
  if (env && fs.existsSync(env)) return env;
  const remotion = findeRemotionBrowser(process.cwd());
  if (remotion) return remotion;
  try {
    const wurzel = '/opt/pw-browsers';
    for (const d of fs.readdirSync(wurzel)) {
      const p = path.join(wurzel, d, d.startsWith('chromium_headless_shell') ? 'chrome-linux/headless_shell' : '');
      if (d.startsWith('chromium_headless_shell') && fs.existsSync(p)) return p;
    }
  } catch {
    /* kein Playwright-Cache */
  }
  return null;
}

describe.skipIf(!browserPfad())('Screenshot mit echtem Browser', () => {
  let server: http.Server;
  let basis = '';
  const angefragt: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      angefragt.push(req.url ?? '');
      if (req.url === '/' || req.url === '/index.html') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<html><body style="margin:0;background:#2563eb"><h1 style="color:#fff;font:700 80px sans-serif;padding:80px">Testseite</h1><div id="cookie-banner" style="position:fixed;inset:0;background:#000">BANNER</div><img src="/geheim.png" width="10" height="10"></body></html>`);
      } else if (req.url === '/fehler') {
        res.statusCode = 404;
        res.end('weg');
      } else {
        res.statusCode = 200;
        res.end('x');
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('erstellt ein JPEG im Format 1280 x 720 und blendet den Cookie-Banner aus; gesperrte Unteranfragen gehen nie raus', async () => {
    angefragt.length = 0;
    const bild = await macheWebsiteScreenshot(`${basis}/`, { browserPfad: browserPfad()!, anfrageErlaubt: async (u) => !u.endsWith('/geheim.png') });
    expect(bild).not.toBeNull();
    expect(bild![0]).toBe(0xff);
    expect(bild![1]).toBe(0xd8);
    expect(bild!.length).toBeGreaterThan(2000);
    expect(bild!.length).toBeLessThan(400 * 1024);
    // Größe aus dem JPEG-Header (SOF0/SOF2)
    let i = 2;
    let breite = 0;
    let hoehe = 0;
    while (i < bild!.length) {
      if (bild![i] !== 0xff) break;
      const marker = bild![i + 1];
      const laenge = bild!.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        hoehe = bild!.readUInt16BE(i + 5);
        breite = bild!.readUInt16BE(i + 7);
        break;
      }
      i += 2 + laenge;
    }
    expect({ breite, hoehe }).toEqual({ breite: 1280, hoehe: 720 });
    expect(angefragt).not.toContain('/geheim.png');
  }, 60_000);

  it('Standard-Schutz: eine Adresse auf localhost wird nie aufgerufen', async () => {
    angefragt.length = 0;
    const bild = await macheWebsiteScreenshot(`${basis}/`, { browserPfad: browserPfad()! });
    expect(bild).toBeNull();
    expect(angefragt).toHaveLength(0);
  }, 30_000);

  it('Fehlerseite (404) und kaputter Browserpfad ergeben null', async () => {
    expect(await macheWebsiteScreenshot(`${basis}/fehler`, { browserPfad: browserPfad()!, anfrageErlaubt: async () => true })).toBeNull();
    expect(await macheWebsiteScreenshot(`${basis}/`, { browserPfad: '/gibt/es/nicht', anfrageErlaubt: async () => true })).toBeNull();
  }, 60_000);
});
