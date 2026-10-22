import { getEnv } from '@/lib/env';
import { decrypt } from '@/lib/crypto';
import { getSetting } from '@/lib/settings';
import { protokolliereKosten } from '../kosten';
import { SuchFehler, type SearchProvider, type SuchOptionen, type SuchTreffer } from './provider';

// Brave Search API: GET https://api.search.brave.com/res/v1/web/search?q=…, Header X-Subscription-Token, Antwort web.results[]

const ENDPUNKT = 'https://api.search.brave.com/res/v1/web/search';
const ZEITLIMIT_MS = 15_000;

/** Wirksamer Schlüssel: App-Einstellung (verschlüsselt) vor .env. */
export function braveSchluessel(): string | undefined {
  const roh = getSetting('brave_api_key');
  if (roh) {
    try {
      const k = decrypt(roh);
      if (k) return k;
    } catch {
      // nicht entschlüsselbar (z. B. ENCRYPTION_KEY gewechselt): auf .env zurückfallen
    }
  }
  return getEnv().BRAVE_SEARCH_API_KEY;
}

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function leseBraveTreffer(json: unknown): SuchTreffer[] {
  const web = istObjekt(json) && istObjekt(json.web) ? json.web : null;
  const liste = web && Array.isArray(web.results) ? web.results : [];
  return liste.filter(istObjekt).flatMap((r) => (typeof r.url === 'string' ? [{ titel: String(r.title ?? ''), url: r.url, snippet: String(r.description ?? '') }] : []));
}

export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave';
  /** `kostenProAnfrageMilliCent`: Preis laut eigenem Brave-Tarif (leer = 0); `runId` ordnet die Kosten einem Lauf zu. */
  constructor(private readonly opt: { f?: typeof fetch; schluessel?: () => string | undefined; runId?: number | null; kostenProAnfrageMilliCent?: number } = {}) {}

  async suche(anfrage: string, opt: SuchOptionen = {}): Promise<SuchTreffer[]> {
    const key = (this.opt.schluessel ?? braveSchluessel)();
    if (!key) throw new SuchFehler('Kein Brave-Search-Schlüssel hinterlegt (BRAVE_SEARCH_API_KEY oder Einstellung).');
    const url = new URL(ENDPUNKT);
    url.searchParams.set('q', anfrage);
    url.searchParams.set('count', String(Math.min(20, opt.anzahl ?? 10)));
    url.searchParams.set('country', (opt.land ?? 'de').toUpperCase());
    url.searchParams.set('search_lang', opt.sprache ?? 'de');
    let res: Response;
    try {
      res = await (this.opt.f ?? fetch)(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': key }, signal: AbortSignal.timeout(ZEITLIMIT_MS) });
    } catch {
      throw new SuchFehler('Keine Verbindung zur Websuche (Brave).', true);
    }
    if (res.status === 429) throw new SuchFehler('Die Websuche (Brave) meldet zu viele Anfragen (Rate-Limit).', true);
    if (res.status === 401 || res.status === 403) throw new SuchFehler('Der Brave-Search-Schlüssel ist ungültig oder hat keine Berechtigung.');
    if (res.status === 422) throw new SuchFehler('Die Websuche (Brave) hat die Anfrage abgelehnt (422).');
    if (!res.ok) throw new SuchFehler(`Die Websuche (Brave) meldet einen Fehler (${res.status}).`, res.status >= 500);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new SuchFehler('Die Antwort der Websuche war kein gültiges JSON.', true);
    }
    protokolliereKosten({ runId: this.opt.runId ?? null, anbieter: 'brave', art: 'suche', einheiten: 1, kostenMilliCent: this.opt.kostenProAnfrageMilliCent ?? 0 });
    return leseBraveTreffer(json);
  }
}
