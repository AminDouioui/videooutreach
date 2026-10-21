import crypto from 'crypto';
import dns from 'dns';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { chromium } from 'playwright-core';

// Website-Screenshot für das Intro: Der Worker ruft die Website des Leads in einem eigenen, kurzlebigen Chromium auf und
// macht ein Bild vom sichtbaren Bereich (1280 x 720). Die Adresse stammt aus den Importdaten, deshalb ist der Aufruf
// gegen Zugriffe auf interne Systeme abgesichert: nur http/https auf den Standard-Ports, jeder Hostname (auch jeder
// Folge-Request der Seite und jede Weiterleitung) muss zu öffentlichen IP-Adressen auflösen, WebSockets und Service
// Worker sind aus. Jedes Problem ergibt "kein Screenshot", nie einen Renderfehler.
// Restrisiko: Zwischen DNS-Prüfung und Chromiums eigener Auflösung liegt ein winziges Zeitfenster (DNS-Rebinding).

export const SCREENSHOT_BREITE = 1280;
export const SCREENSHOT_HOEHE = 720;
const GESAMT_ZEITLIMIT_MS = 30_000;
const LADE_ZEITLIMIT_MS = 15_000;
const BERUHIGUNG_MS = 1500;
const MAX_DATEN_BYTES = 400 * 1024;
const CACHE_TAGE = 7;

// ---------------------------------------------------------------- Adressen

/** "firma.de", "www.firma.de/start" oder eine volle URL → https/http-URL ohne Zugangsdaten; sonst null. */
export function normalisiereWebsite(roh: string | null | undefined): string | null {
  const t = (roh ?? '').trim();
  if (!t || t.length > 500 || /\s/.test(t)) return null;
  const mitSchema = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  let u: URL;
  try {
    u = new URL(mitSchema);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  if (!u.hostname.includes('.') && !net.isIP(u.hostname.replace(/^\[|\]$/g, ''))) return null;
  return u.toString();
}

function ipv4Oeffentlich(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

/** true nur für öffentlich routbare IPv4/IPv6-Adressen (kein privat, loopback, link-local, CGNAT, Doku, Multicast). */
export function istOeffentlicheIp(ip: string): boolean {
  const art = net.isIP(ip);
  if (art === 4) return ipv4Oeffentlich(ip);
  if (art !== 6) return false;
  const klein = ip.toLowerCase();
  // IPv4 eingebettet (::ffff:1.2.3.4, 64:ff9b::1.2.3.4)
  const eingebettet = /(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(klein);
  if (eingebettet) return ipv4Oeffentlich(eingebettet[1]);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(klein);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return ipv4Oeffentlich(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (klein === '::' || klein === '::1') return false;
  if (/^f[cd]/.test(klein) || /^fe[89ab]/.test(klein) || /^ff/.test(klein)) return false; // ULA, link-local, multicast
  if (klein.startsWith('2001:db8')) return false;
  return true;
}

export type DnsLookup = (hostname: string) => Promise<string[]>;

const standardLookup: DnsLookup = async (hostname) => (await dns.promises.lookup(hostname, { all: true })).map((a) => a.address);

/** Löst den Hostnamen auf; nur wenn alle Adressen öffentlich sind (und es mindestens eine gibt), gilt er als erlaubt. */
export async function istOeffentlicherHost(hostname: string, lookup: DnsLookup = standardLookup): Promise<boolean> {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (net.isIP(h)) return istOeffentlicheIp(h);
  try {
    const adressen = await lookup(h);
    return adressen.length > 0 && adressen.every(istOeffentlicheIp);
  } catch {
    return false;
  }
}

/** Darf Chromium diese Anfrage senden? (http/https, Standard-Port, öffentlicher Host). data:/blob:/about: sind lokal und harmlos. */
export async function erlaubeAnfrage(url: string, lookup: DnsLookup = standardLookup): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return true;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.port && u.port !== '80' && u.port !== '443') return false;
  return istOeffentlicherHost(u.hostname, lookup);
}

/** Anzeigename für die Adresszeile im Intro: Host ohne "www." */
export function anzeigeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- Cookie-Banner ausblenden

/** Häufige Cookie- und Einwilligungs-Banner verdecken das Bild; sie werden per CSS ausgeblendet (bestmöglich, nicht vollständig). */
export const BANNER_CSS = `
#onetrust-consent-sdk, #onetrust-banner-sdk, #CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay, #usercentrics-root, #cmpbox, #cmpwrapper,
.cmp-wrapper, .cc-window, .cc-banner, #cookie-law-info-bar, #cookiescript_injected, #borlabs-cookie, .borlabs-cookie, #cookie-notice, .cookie-notice,
#cookie-banner, .cookie-banner, #cookieBanner, .cookieBanner, #cookie-consent, .cookie-consent, #consent-banner, .consent-banner, #gdpr-cookie-notice,
[id*="cookie-banner" i], [class*="cookie-banner" i], [id*="cookiebanner" i], [class*="cookiebanner" i], [aria-label*="cookie" i][role="dialog"],
[id^="sp_message_container"], .qc-cmp2-container, .truste_box_overlay, #didomi-host, .fc-consent-root { display: none !important; visibility: hidden !important; }
html, body { overflow: auto !important; }
`;

// ---------------------------------------------------------------- Browser

export type ScreenshotOptionen = {
  /** Pfad zur Chromium-Binärdatei (chrome-headless-shell oder Chrome) */
  browserPfad: string;
  lookup?: DnsLookup;
  /** Nur Tests: ersetzt die Host-Prüfung (z. B. um einen lokalen Testserver zu erlauben) */
  anfrageErlaubt?: (url: string) => Promise<boolean>;
};

/** Macht den Screenshot (JPEG) oder liefert null. Öffnet je Aufruf einen eigenen Browser und schließt ihn sicher. */
export async function macheWebsiteScreenshot(rohUrl: string, opt: ScreenshotOptionen): Promise<Buffer | null> {
  // Mit überschriebener Prüfung (nur Tests) gilt die URL unverändert, sonst die normalisierte (Standard-Ports, keine Zugangsdaten)
  const url = opt.anfrageErlaubt ? rohUrl : normalisiereWebsite(rohUrl);
  if (!url) return null;
  const erlaubt = opt.anfrageErlaubt ?? ((u: string) => erlaubeAnfrage(u, opt.lookup));
  if (!(await erlaubt(url))) return null;
  const browser = await chromium.launch({ executablePath: opt.browserPfad, headless: true, args: ['--disable-dev-shm-usage', '--mute-audio', '--hide-scrollbars'] }).catch(() => null);
  if (!browser) return null;
  let timer: NodeJS.Timeout | undefined;
  try {
    const arbeit = (async (): Promise<Buffer | null> => {
      const context = await browser.newContext({
        viewport: { width: SCREENSHOT_BREITE, height: SCREENSHOT_HOEHE },
        locale: 'de-DE',
        acceptDownloads: false,
        serviceWorkers: 'block',
        permissions: [],
      });
      await context.routeWebSocket(/.*/, (ws) => void ws.close());
      await context.route('**/*', async (route) => {
        if (await erlaubt(route.request().url())) await route.continue().catch(() => undefined);
        else await route.abort('blockedbyclient').catch(() => undefined);
      });
      const page = await context.newPage();
      const antwort = await page.goto(url, { waitUntil: 'load', timeout: LADE_ZEITLIMIT_MS });
      if (!antwort || antwort.status() >= 400) return null;
      await page.addStyleTag({ content: BANNER_CSS }).catch(() => undefined);
      await page.waitForTimeout(BERUHIGUNG_MS);
      for (const qualitaet of [70, 55, 40]) {
        const bild = await page.screenshot({ type: 'jpeg', quality: qualitaet, clip: { x: 0, y: 0, width: SCREENSHOT_BREITE, height: SCREENSHOT_HOEHE } });
        if (bild.length <= MAX_DATEN_BYTES) return bild;
      }
      return null;
    })();
    const zeitlimit = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), GESAMT_ZEITLIMIT_MS);
    });
    return await Promise.race([arbeit.catch(() => null), zeitlimit]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    await browser.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- Cache und Data-URI

/** Pfad im Cache (`<cacheDir>/screens/<sha1 der URL>.jpg`) */
export function screenshotCachePfad(cacheDir: string, url: string): string {
  return path.join(cacheDir, 'screens', `${crypto.createHash('sha1').update(url).digest('hex')}.jpg`);
}

/**
 * Screenshot als data:-URI für das Intro (Remotion braucht eine URL; so entfällt eine öffentliche Auslieferung). Ergebnisse
 * werden sieben Tage im Cache gehalten, damit ein erneutes Rendern keinen erneuten Abruf der Kundenwebsite auslöst.
 */
export async function websiteScreenshotDataUri(
  rohUrl: string | null | undefined,
  cacheDir: string,
  opt: ScreenshotOptionen | null,
  jetzt: number = Date.now(),
): Promise<{ dataUri: string; host: string } | null> {
  const url = normalisiereWebsite(rohUrl);
  if (!url) return null;
  const datei = screenshotCachePfad(cacheDir, url);
  let bild: Buffer | null = null;
  try {
    const st = fs.statSync(datei);
    if (jetzt - st.mtimeMs < CACHE_TAGE * 24 * 3600_000) bild = fs.readFileSync(datei);
  } catch {
    /* kein Cache */
  }
  if (!bild) {
    if (!opt) return null;
    bild = await macheWebsiteScreenshot(url, opt);
    if (!bild) return null;
    try {
      fs.mkdirSync(path.dirname(datei), { recursive: true });
      fs.writeFileSync(datei, bild);
    } catch {
      /* Cache ist optional */
    }
  }
  return { dataUri: `data:image/jpeg;base64,${bild.toString('base64')}`, host: anzeigeHost(url) };
}

/** Sucht die von Remotion geladene chrome-headless-shell (node_modules/.remotion), falls kein Pfad vorgegeben ist. */
export function findeRemotionBrowser(wurzel: string): string | null {
  const basis = path.join(wurzel, 'node_modules', '.remotion');
  const namen = new Set(['chrome-headless-shell', 'headless_shell']);
  const suche = (dir: string, tiefe: number): string | null => {
    if (tiefe > 4) return null;
    let eintraege: fs.Dirent[];
    try {
      eintraege = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of eintraege) if (e.isFile() && namen.has(e.name)) return path.join(dir, e.name);
    for (const e of eintraege) if (e.isDirectory()) {
      const r = suche(path.join(dir, e.name), tiefe + 1);
      if (r) return r;
    }
    return null;
  };
  return suche(basis, 0);
}
