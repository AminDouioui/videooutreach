import { z } from 'zod';
import { decrypt, encrypt } from './crypto';
import { getEnv } from './env';
import { deleteSetting, getSetting, maskiereSchluessel, setSetting } from './settings';

// Anbindung an das Brain (Second Brain von Prozessia, FastAPI): liest Lead-Kontext (Notizen, Felder, letzte Kundendokumente)
// für KI-Antwortentwürfe und die Anzeige „Aus dem Brain“. Nur lesend; Schnittstelle: docs/brain-integration.md.
//   GET {BRAIN_URL}/api/extern/health        mit Authorization: Bearer <Token>
//   GET {BRAIN_URL}/api/extern/lead-kontext  ?email=&domain=&firma=
// Fehler werden nie geworfen: ohne Brain läuft alles wie bisher. Der Token steht nur verschlüsselt in der DB (bzw. in der .env),
// nie in Antworten, HTML oder Logs.

export const BRAIN_ZEITLIMIT_MS = 5_000;
export const BRAIN_CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;
const MAX_ANTWORT_BYTES = 200_000;

// ---------------------------------------------------------------- Konfiguration (Einstellung vor .env)

export type BrainQuelle = 'app' | 'env';
export type BrainKonfig = { url: string; token: string; urlQuelle: BrainQuelle; tokenQuelle: BrainQuelle };

function appToken(): string | null {
  const roh = getSetting('brain_token');
  if (!roh) return null;
  try {
    return decrypt(roh) || null;
  } catch {
    return null;
  }
}

/** Wirksame Konfiguration (URL und Token müssen beide vorhanden sein), sonst null. */
export function brainKonfig(): BrainKonfig | null {
  const env = getEnv();
  const urlApp = getSetting('brain_url')?.trim();
  const url = urlApp || env.BRAIN_URL?.trim();
  const tokenApp = appToken();
  const token = tokenApp || env.BRAIN_API_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token, urlQuelle: urlApp ? 'app' : 'env', tokenQuelle: tokenApp ? 'app' : 'env' };
}

export function brainVerbunden(): boolean {
  return brainKonfig() !== null;
}

/** Zustand für die Oberfläche: nie der Token selbst; die Maske („…abcd“) nur auf Wunsch (Admin). */
export type BrainStatus = { url: string; urlQuelle: BrainQuelle | null; tokenGesetzt: boolean; tokenQuelle: BrainQuelle | null; tokenMaske: string | null; appGespeichert: boolean; verbunden: boolean };

export function brainStatus(mitMaske: boolean): BrainStatus {
  const env = getEnv();
  const urlApp = getSetting('brain_url')?.trim() || '';
  const tokenApp = appToken();
  const urlEnv = env.BRAIN_URL?.trim() || '';
  const tokenEnv = env.BRAIN_API_TOKEN?.trim() || '';
  const token = tokenApp || tokenEnv;
  const url = urlApp || urlEnv;
  return {
    url,
    urlQuelle: urlApp ? 'app' : urlEnv ? 'env' : null,
    tokenGesetzt: !!token,
    tokenQuelle: tokenApp ? 'app' : tokenEnv ? 'env' : null,
    tokenMaske: token && mitMaske ? maskiereSchluessel(token) : null,
    appGespeichert: !!urlApp || !!tokenApp,
    verbunden: !!url && !!token,
  };
}

/** Prüft die Eingabe der Brain-URL: http(s), keine Zugangsdaten/Query in der URL. Liefert die bereinigte URL ohne Schrägstrich am Ende. */
export function normalisiereBrainUrl(roh: string): { ok: true; wert: string } | { ok: false; fehler: string } {
  const t = roh.trim();
  if (!t) return { ok: false, fehler: 'Bitte die Brain-URL eingeben.' };
  if (t.length > 500) return { ok: false, fehler: 'Die URL ist zu lang.' };
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { ok: false, fehler: 'Die Brain-URL ist ungültig (Beispiel: https://brain.prozessia.space).' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, fehler: 'Die Brain-URL muss mit https:// (oder http://) beginnen.' };
  if (u.username || u.password) return { ok: false, fehler: 'Die Brain-URL darf keine Zugangsdaten enthalten. Den Token bitte im Feld „Token“ eintragen.' };
  if (u.search || u.hash) return { ok: false, fehler: 'Die Brain-URL darf keine Parameter enthalten.' };
  return { ok: true, wert: `${u.origin}${u.pathname.replace(/\/+$/, '')}` };
}

/** Prüft den Token leicht: nicht leer, keine Leerzeichen/Steuerzeichen, höchstens 300 Zeichen. */
export function pruefeBrainToken(roh: string): { ok: true; wert: string } | { ok: false; fehler: string } {
  const wert = roh.trim();
  if (!wert) return { ok: false, fehler: 'Bitte den Token eingeben.' };
  if (wert.length > 300) return { ok: false, fehler: 'Der Token ist zu lang (höchstens 300 Zeichen).' };
  if (/[\s\u0000-\u001f\u007f]/.test(wert)) return { ok: false, fehler: 'Der Token darf keine Leerzeichen oder Zeilenumbrüche enthalten.' };
  return { ok: true, wert };
}

/** Speichert URL und/oder Token (Token verschlüsselt). Eingaben müssen vorher geprüft sein. */
export function setzeBrain(werte: { url?: string; token?: string }): void {
  if (werte.url !== undefined) setSetting('brain_url', werte.url);
  if (werte.token !== undefined) setSetting('brain_token', encrypt(werte.token));
  leereBrainCache();
}

/** Entfernt die in der App gespeicherten Werte; Werte aus der .env bleiben wirksam. */
export function loescheBrain(): void {
  deleteSetting('brain_url');
  deleteSetting('brain_token');
  leereBrainCache();
}

// ---------------------------------------------------------------- Fehlertexte und HTTP

export type BrainFetch = typeof fetch;

function statusMeldung(status: number): string {
  if (status === 401 || status === 403) return `Das Brain lehnt den Token ab (${status}). Bitte den Token prüfen (EXTERN_API_TOKEN im Brain).`;
  if (status === 503) return 'Die Brain-Schnittstelle ist dort nicht aktiviert (EXTERN_API_TOKEN im Brain nicht gesetzt).';
  if (status === 404) return 'Die Schnittstelle wurde unter dieser Brain-URL nicht gefunden (URL oder Brain-Version prüfen).';
  if (status === 429) return 'Das Brain meldet zu viele Anfragen (429). Bitte später erneut versuchen.';
  if (status === 400) return 'Das Brain hat die Anfrage abgelehnt (400).';
  if (status >= 500) return `Das Brain meldet einen Serverfehler (${status}).`;
  return `Unerwartete Antwort des Brains (${status}).`;
}

type HttpErgebnis = { ok: true; json: unknown } | { ok: false; meldung: string };

async function holeJson(f: BrainFetch, konfig: { url: string; token: string }, pfad: string, query?: URLSearchParams): Promise<HttpErgebnis> {
  const url = `${konfig.url}${pfad}${query && [...query.keys()].length ? `?${query.toString()}` : ''}`;
  let res: Response;
  try {
    // Kein Weiterleiten: der Token darf nicht an eine andere Adresse gehen
    res = await f(url, { method: 'GET', headers: { Authorization: `Bearer ${konfig.token}`, Accept: 'application/json' }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(BRAIN_ZEITLIMIT_MS) });
  } catch (e) {
    const zeit = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ok: false, meldung: zeit ? `Das Brain hat nicht innerhalb von ${BRAIN_ZEITLIMIT_MS / 1000} Sekunden geantwortet.` : 'Das Brain ist nicht erreichbar (Adresse oder Netzwerk prüfen).' };
  }
  if (!res.ok) {
    void res.body?.cancel().catch(() => {});
    return { ok: false, meldung: statusMeldung(res.status) };
  }
  try {
    const text = await res.text();
    if (text.length > MAX_ANTWORT_BYTES) return { ok: false, meldung: 'Die Antwort des Brains ist unerwartet groß.' };
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, meldung: 'Die Antwort des Brains war kein gültiges JSON (stimmt die URL?).' };
  }
}

/** „Verbindung testen“: GET /api/extern/health. Mit `url`/`token` wird die Eingabe geprüft, sonst die wirksame Konfiguration. */
export async function testeBrainVerbindung(eingabe: { url?: string; token?: string } = {}, f: BrainFetch = fetch): Promise<{ ok: boolean; meldung: string }> {
  const wirksam = brainKonfig();
  const url = eingabe.url ?? wirksam?.url;
  const token = eingabe.token ?? wirksam?.token;
  if (!url) return { ok: false, meldung: 'Keine Brain-URL hinterlegt.' };
  if (!token) return { ok: false, meldung: 'Kein Token hinterlegt.' };
  const r = await holeJson(f, { url, token }, '/api/extern/health');
  if (!r.ok) return { ok: false, meldung: r.meldung };
  const ok = typeof r.json === 'object' && r.json !== null && (r.json as { ok?: unknown }).ok === true;
  return ok ? { ok: true, meldung: 'Verbindung zum Brain steht.' } : { ok: false, meldung: 'Das Brain antwortet, meldet aber nicht „ok“ (stimmt die URL?).' };
}

// ---------------------------------------------------------------- Lead-Kontext

export type BrainDokument = { datei: string; titel: string; datum: string; auszug: string };
export type BrainKontext = {
  gefunden: boolean;
  lead: { datei: string; firma: string; status: string; score: string; felder: [string, string][]; notizen: string } | null;
  kunde: { ordner: string; dokumente: BrainDokument[] } | null;
  stand: string;
};

export type BrainErgebnis =
  | { status: 'ok'; daten: BrainKontext; geladenAt: number; ausCache: boolean }
  | { status: 'nicht_konfiguriert' }
  | { status: 'fehler'; meldung: string };

// Tolerant: unbekannte Felder werden ignoriert, fehlende/falsch typisierte Teile fallen auf leer zurück. Nur ein Objekt mit
// boolschem `gefunden` gilt als Antwort des Brains.
const text = z.union([z.string(), z.number(), z.boolean()]).transform(String).nullish().catch(undefined);
const dokumentZod = z.object({ datei: text, titel: text, datum: text, auszug: text });
const antwortZod = z.object({
  gefunden: z.boolean(),
  lead: z
    .object({ datei: text, firma: text, status: text, score: text, felder: z.record(z.string(), z.unknown()).nullish().catch(undefined), notizen: text })
    .nullish()
    .catch(null),
  kunde: z
    .object({ ordner: text, dokumente: z.array(z.unknown()).nullish().catch(undefined) })
    .nullish()
    .catch(null),
  stand: text,
});

/** Steuerzeichen raus, gekürzt */
function sauber(s: string | null | undefined, max: number): string {
  const t = (s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()} …` : t;
}

function normalisiere(json: unknown): BrainKontext | null {
  const p = antwortZod.safeParse(json);
  if (!p.success) return null;
  const d = p.data;
  const lead = d.lead
    ? {
        datei: sauber(d.lead.datei, 300),
        firma: sauber(d.lead.firma, 200),
        status: sauber(d.lead.status, 100),
        score: sauber(d.lead.score, 100),
        felder: Object.entries(d.lead.felder ?? {})
          .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
          .slice(0, 30)
          .map(([k, v]): [string, string] => [sauber(k, 60), sauber(String(v), 200)]),
        notizen: sauber(d.lead.notizen, 3000),
      }
    : null;
  const dokumente = (d.kunde?.dokumente ?? [])
    .map((x) => dokumentZod.safeParse(x))
    .flatMap((r) => (r.success ? [r.data] : []))
    .slice(0, 5)
    .map((x): BrainDokument => ({ datei: sauber(x.datei, 300), titel: sauber(x.titel, 200), datum: sauber(x.datum, 40), auszug: sauber(x.auszug, 800) }));
  const kunde = d.kunde ? { ordner: sauber(d.kunde.ordner, 300), dokumente } : null;
  return { gefunden: d.gefunden && (!!lead || !!kunde), lead, kunde, stand: sauber(d.stand, 40) };
}

const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'web.de', 't-online.de', 'outlook.com', 'outlook.de', 'hotmail.com', 'hotmail.de', 'live.de', 'live.com', 'yahoo.com', 'yahoo.de', 'icloud.com', 'me.com', 'freenet.de', 'posteo.de', 'mail.de', 'online.de', 'aol.com', 'proton.me', 'protonmail.com']);

/** Domain für die Zuordnung: aus der Website, sonst aus der E-Mail-Adresse; Freemail-Domains nie. */
export function brainDomain(lead: { email: string; website?: string | null }): string | null {
  const ausWebsite = (() => {
    const w = lead.website?.trim();
    if (!w) return null;
    try {
      return new URL(/^[a-z]+:\/\//i.test(w) ? w : `https://${w}`).hostname.toLowerCase().replace(/^www\./, '') || null;
    } catch {
      return null;
    }
  })();
  const ausMail = lead.email.includes('@') ? lead.email.split('@').pop()!.trim().toLowerCase() : null;
  const d = ausWebsite ?? ausMail;
  return d && !FREEMAIL.has(d) && d.includes('.') ? d : null;
}

export type BrainLead = { id: number; email: string; firma: string; website?: string | null };
export type BrainOptionen = { fetch?: BrainFetch; jetzt?: number; /** Cache ignorieren und neu laden */ frisch?: boolean };

const cache = new Map<string, { bis: number; geladenAt: number; daten: BrainKontext }>();

export function leereBrainCache(): void {
  cache.clear();
}

/**
 * Kontext des Leads aus dem Brain. 5 s Zeitlimit, Ergebnis 10 Minuten je Lead im Speicher. Wirft nie: Fehler kommen als
 * { status: 'fehler', meldung }, ein nicht eingerichtetes Brain als { status: 'nicht_konfiguriert' }.
 */
export async function ladeLeadKontext(lead: BrainLead, opt: BrainOptionen = {}): Promise<BrainErgebnis> {
  try {
    const konfig = brainKonfig();
    if (!konfig) return { status: 'nicht_konfiguriert' };
    const jetzt = opt.jetzt ?? Date.now();
    const key = `${konfig.url}|${lead.id}`;
    const treffer = cache.get(key);
    if (!opt.frisch && treffer && treffer.bis > jetzt) return { status: 'ok', daten: treffer.daten, geladenAt: treffer.geladenAt, ausCache: true };
    const q = new URLSearchParams();
    if (lead.email.trim()) q.set('email', lead.email.trim().toLowerCase());
    const domain = brainDomain(lead);
    if (domain) q.set('domain', domain);
    if (lead.firma.trim()) q.set('firma', lead.firma.trim().slice(0, 200));
    const r = await holeJson(opt.fetch ?? fetch, konfig, '/api/extern/lead-kontext', q);
    if (!r.ok) return { status: 'fehler', meldung: r.meldung };
    const daten = normalisiere(r.json);
    if (!daten) return { status: 'fehler', meldung: 'Die Antwort des Brains hatte ein unerwartetes Format.' };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { bis: jetzt + BRAIN_CACHE_MS, geladenAt: jetzt, daten });
    return { status: 'ok', daten, geladenAt: jetzt, ausCache: false };
  } catch {
    return { status: 'fehler', meldung: 'Der Brain-Kontext konnte nicht geladen werden.' };
  }
}

/** Kontext als Text für den KI-Prompt (gekürzt auf `max` Zeichen); leer, wenn nichts gefunden wurde. */
export function kontextFuerPrompt(k: BrainKontext, max = 4000): string {
  if (!k.gefunden) return '';
  const teile: string[] = [];
  if (k.lead) {
    const kopf = [k.lead.firma && `Firma: ${k.lead.firma}`, k.lead.status && `Status: ${k.lead.status}`, k.lead.score && `Score: ${k.lead.score}`].filter(Boolean).join('; ');
    if (kopf) teile.push(kopf);
    if (k.lead.felder.length) teile.push(k.lead.felder.map(([a, b]) => `${a}: ${b}`).join('; '));
    if (k.lead.notizen) teile.push(`Lead-Notizen:\n${k.lead.notizen}`);
  }
  if (k.kunde) {
    for (const d of k.kunde.dokumente) teile.push(`Dokument${d.datum ? ` vom ${d.datum}` : ''}${d.titel ? `, ${d.titel}` : ''}:\n${d.auszug}`);
  }
  const t = teile.join('\n\n').trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()} …` : t;
}
