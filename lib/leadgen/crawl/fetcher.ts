import robotsParser from 'robots-parser';
import { getDb, type Db } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { pruefeWebhookZiel, type HostResolver } from '@/lib/webhook-logik';
import { neuesterStand, speichereRohdokument } from '../raw-store';

// Höflicher Abruf von Firmenwebseiten: robots.txt respektieren, Rate-Limit je Domain, eigener User-Agent, Cache in der
// Rohdaten-Schicht (Quelle 'web'), Schutz vor Zielen im internen Netz, Größen- und Zeitlimit. Crawl und Extraktion sind getrennt:
// hier wird nur abgerufen und unverändert gespeichert.

export const WEB_QUELLE = 'web';

export type SeitenAbruf =
  | { status: 'ok'; url: string; finaleUrl: string; html: string; rawDocumentId: number; ausCache: boolean }
  | { status: 'robots'; url: string }
  | { status: 'fehler'; url: string; fehler: string };

export type FetcherOptionen = {
  f?: typeof fetch;
  userAgent?: string;
  /** Mindestabstand zwischen zwei Abrufen derselben Domain */
  minAbstandMs?: number;
  /** So lange gilt eine gecachte Seite, ohne neu geholt zu werden */
  cacheMs?: number;
  maxBytes?: number;
  zeitlimitMs?: number;
  maxWeiterleitungen?: number;
  resolver?: HostResolver;
  /** Tests: Ziele im lokalen Netz erlauben */
  privatErlaubt?: boolean;
  jetzt?: () => number;
  warte?: (ms: number) => Promise<void>;
  db?: Db;
};

const STANDARD_UA = 'ProzessiaLeadBot/1.0 (+mailto:kontakt@prozessia.de)';

export class HoeflicherFetcher {
  private readonly letzterAbruf = new Map<string, number>();
  private readonly warteschlange = new Map<string, Promise<void>>();
  private readonly robots = new Map<string, { bis: number; regeln: ReturnType<typeof robotsParser> | null; fehler?: string }>();
  readonly userAgent: string;
  private readonly opt: Required<Pick<FetcherOptionen, 'minAbstandMs' | 'cacheMs' | 'maxBytes' | 'zeitlimitMs' | 'maxWeiterleitungen'>> & FetcherOptionen;

  constructor(opt: FetcherOptionen = {}) {
    this.userAgent = opt.userAgent ?? getEnv().LEADGEN_CRAWL_UA ?? STANDARD_UA;
    this.opt = { minAbstandMs: 3000, cacheMs: 14 * 24 * 3600_000, maxBytes: 1_500_000, zeitlimitMs: 15_000, maxWeiterleitungen: 3, ...opt };
  }

  private jetzt(): number {
    return (this.opt.jetzt ?? Date.now)();
  }

  private db(): Db {
    return this.opt.db ?? getDb();
  }

  /** Hält den Mindestabstand je Host ein; Abrufe desselben Hosts werden hintereinander gestellt. */
  private async drosseln(host: string, abstandMs: number): Promise<void> {
    const vorher = this.warteschlange.get(host) ?? Promise.resolve();
    const dran = vorher.then(async () => {
      const warten = (this.letzterAbruf.get(host) ?? 0) + abstandMs - this.jetzt();
      if (warten > 0) await (this.opt.warte ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(warten);
      this.letzterAbruf.set(host, this.jetzt());
    });
    this.warteschlange.set(host, dran.catch(() => undefined));
    await dran;
  }

  private async rohAbruf(url: string, akzeptiere: string): Promise<{ res: Response; finaleUrl: string } | { fehler: string }> {
    let aktuell = url;
    for (let hop = 0; hop <= this.opt.maxWeiterleitungen; hop++) {
      const ziel = await pruefeWebhookZiel(aktuell, { resolver: this.opt.resolver, privatErlaubt: this.opt.privatErlaubt });
      if (!ziel.ok) return { fehler: `Ziel nicht erlaubt: ${ziel.grund}` };
      const host = new URL(aktuell).host;
      await this.drosseln(host, Math.max(this.opt.minAbstandMs, (await this.crawlDelayMs(aktuell)) ?? 0));
      let res: Response;
      try {
        res = await (this.opt.f ?? fetch)(aktuell, {
          redirect: 'manual',
          headers: { 'User-Agent': this.userAgent, Accept: akzeptiere, 'Accept-Language': 'de,en;q=0.5' },
          signal: AbortSignal.timeout(this.opt.zeitlimitMs),
        });
      } catch {
        return { fehler: 'Keine Verbindung oder Zeitüberschreitung' };
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        try {
          aktuell = new URL(res.headers.get('location')!, aktuell).toString();
        } catch {
          return { fehler: 'Ungültige Weiterleitung' };
        }
        // Auch das Weiterleitungsziel muss robots.txt erlauben
        if (!(await this.erlaubt(aktuell)).erlaubt) return { fehler: 'Weiterleitung auf eine durch robots.txt gesperrte Seite' };
        continue;
      }
      return { res, finaleUrl: aktuell };
    }
    return { fehler: 'Zu viele Weiterleitungen' };
  }

  private async crawlDelayMs(url: string): Promise<number | null> {
    const r = this.robots.get(new URL(url).origin)?.regeln;
    const d = r?.getCrawlDelay(this.userAgent);
    return typeof d === 'number' && d > 0 ? Math.min(d, 30) * 1000 : null;
  }

  /** robots.txt der Domain (24 h gemerkt). 4xx = alles erlaubt, 5xx oder Netzfehler = vorsichtshalber nichts erlaubt (RFC 9309). */
  private async erlaubt(url: string): Promise<{ erlaubt: boolean; fehler?: string }> {
    const origin = new URL(url).origin;
    let eintrag = this.robots.get(origin);
    if (!eintrag || eintrag.bis < this.jetzt()) {
      const robotsUrl = `${origin}/robots.txt`;
      const antwort = await this.rohAbrufOhneRobots(robotsUrl);
      if ('fehler' in antwort) eintrag = { bis: this.jetzt() + 5 * 60_000, regeln: null, fehler: antwort.fehler };
      else if (antwort.status >= 500) eintrag = { bis: this.jetzt() + 5 * 60_000, regeln: null, fehler: `robots.txt nicht abrufbar (${antwort.status})` };
      else if (antwort.status >= 400) eintrag = { bis: this.jetzt() + 24 * 3600_000, regeln: robotsParser(robotsUrl, '') };
      else eintrag = { bis: this.jetzt() + 24 * 3600_000, regeln: robotsParser(robotsUrl, antwort.text) };
      this.robots.set(origin, eintrag);
    }
    if (!eintrag.regeln) return { erlaubt: false, fehler: eintrag.fehler };
    return { erlaubt: eintrag.regeln.isAllowed(url, this.userAgent) !== false };
  }

  private async rohAbrufOhneRobots(url: string): Promise<{ status: number; text: string } | { fehler: string }> {
    const ziel = await pruefeWebhookZiel(url, { resolver: this.opt.resolver, privatErlaubt: this.opt.privatErlaubt });
    if (!ziel.ok) return { fehler: `Ziel nicht erlaubt: ${ziel.grund}` };
    await this.drosseln(new URL(url).host, this.opt.minAbstandMs);
    try {
      const res = await (this.opt.f ?? fetch)(url, { headers: { 'User-Agent': this.userAgent, Accept: 'text/plain' }, signal: AbortSignal.timeout(this.opt.zeitlimitMs), redirect: 'follow' });
      return { status: res.status, text: res.ok ? (await res.text()).slice(0, 500_000) : '' };
    } catch {
      return { fehler: 'robots.txt nicht abrufbar' };
    }
  }

  async holeSeite(url: string): Promise<SeitenAbruf> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { status: 'fehler', url, fehler: 'Ungültige URL' };
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { status: 'fehler', url, fehler: 'Nur http und https' };
    u.hash = '';
    const sauber = u.toString();

    // Cache: frisch Geholtes nicht noch einmal anfragen (kein Netzverkehr, keine Wartezeit)
    const stand = neuesterStand(WEB_QUELLE, sauber, this.db());
    if (stand && this.jetzt() - stand.abgerufenAm.getTime() < this.opt.cacheMs) {
      return { status: 'ok', url: sauber, finaleUrl: stand.url ?? sauber, html: stand.inhalt, rawDocumentId: stand.id, ausCache: true };
    }

    const r = await this.erlaubt(sauber);
    if (r.fehler) return { status: 'fehler', url: sauber, fehler: r.fehler };
    if (!r.erlaubt) return { status: 'robots', url: sauber };

    const antwort = await this.rohAbruf(sauber, 'text/html,application/xhtml+xml');
    if ('fehler' in antwort) return { status: 'fehler', url: sauber, fehler: antwort.fehler };
    const { res, finaleUrl } = antwort;
    if (!res.ok) return { status: 'fehler', url: sauber, fehler: `HTTP ${res.status}` };
    const typ = res.headers.get('content-type') ?? '';
    if (typ && !/html|xml/i.test(typ)) return { status: 'fehler', url: sauber, fehler: `Kein HTML (${typ.split(';')[0]})` };
    const html = await leseKoerper(res, this.opt.maxBytes, typ);
    if (html === null) return { status: 'fehler', url: sauber, fehler: 'Seite zu groß' };
    const { id } = speichereRohdokument({ quelle: WEB_QUELLE, referenz: sauber, url: finaleUrl, contentType: 'text/html', inhalt: html }, this.db());
    return { status: 'ok', url: sauber, finaleUrl, html, rawDocumentId: id, ausCache: false };
  }
}

/** Liest den Antworttext bis zur Größengrenze (null = zu groß); Zeichensatz aus dem Header, Standard UTF-8. */
async function leseKoerper(res: Response, maxBytes: number, contentType: string): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const teile: Uint8Array[] = [];
  let summe = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    summe += value.byteLength;
    if (summe > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    teile.push(value);
  }
  const bytes = Buffer.concat(teile);
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(bytes.subarray(0, 2048).toString('latin1'))?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
