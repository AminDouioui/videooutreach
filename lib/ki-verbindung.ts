import { getEnv } from './env';
import { kiSchluessel, type KiAnbieter } from './settings';

// Verbindungstest für einen KI-Schlüssel: ein minimaler lesender Aufruf (Modell-/Schlüsselinfo, keine Kosten, keine Mailinhalte).
// Der Schlüssel wird nur im Authorization-Header gesendet; er steht weder in der Antwort noch in Logs.

export const VERBINDUNGSTEST_ZEITLIMIT_MS = 10_000;

export type VerbindungsErgebnis = { ok: boolean; meldung: string; status?: number };

function basis(url: string): string {
  return url.replace(/\/+$/, '');
}

/** URL und Header des Testaufrufs je Anbieter */
function anfrage(anbieter: KiAnbieter, schluessel: string): { url: string; headers: Record<string, string> } {
  const env = getEnv();
  if (anbieter === 'openai') return { url: `${basis(env.OPENAI_BASE_URL)}/models`, headers: { Authorization: `Bearer ${schluessel}` } };
  // OpenRouter: /v1/key liefert Infos zum Schlüssel und verlangt ihn (die Modellliste /v1/models ist öffentlich und würde jeden Wert akzeptieren)
  if (anbieter === 'openrouter') return { url: `${basis(env.JEV_BASE_URL)}/v1/key`, headers: { Authorization: `Bearer ${schluessel}` } };
  const anthropicBasis = basis(process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com');
  return { url: `${anthropicBasis}/v1/models?limit=1`, headers: { 'x-api-key': schluessel, 'anthropic-version': '2023-06-01' } };
}

/**
 * Prüft `schluessel` (sonst den wirksamen Schlüssel des Anbieters) mit einem minimalen Aufruf.
 * `f` ist injizierbar (Tests). Ergebnis als deutsche Meldung: „Schlüssel gültig“, „Schlüssel ungültig (401)“, „Keine Verbindung“.
 */
export async function testeKiVerbindung(anbieter: KiAnbieter, schluessel?: string, f: typeof fetch = fetch): Promise<VerbindungsErgebnis> {
  const key = schluessel ?? kiSchluessel(anbieter);
  if (!key) return { ok: false, meldung: 'Kein Schlüssel hinterlegt.' };
  const a = anfrage(anbieter, key);
  let res: Response;
  try {
    res = await f(a.url, { method: 'GET', headers: a.headers, cache: 'no-store', signal: AbortSignal.timeout(VERBINDUNGSTEST_ZEITLIMIT_MS) });
  } catch (e) {
    const zeit = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ok: false, meldung: zeit ? 'Keine Verbindung (Zeitüberschreitung)' : 'Keine Verbindung' };
  }
  // Antwortkörper nicht auslesen oder weitergeben
  void res.body?.cancel().catch(() => {});
  if (res.ok) return { ok: true, meldung: 'Schlüssel gültig', status: res.status };
  if (res.status === 401 || res.status === 403) return { ok: false, meldung: `Schlüssel ungültig (${res.status})`, status: res.status };
  if (res.status === 429) return { ok: false, meldung: 'Schlüssel nicht prüfbar: zu viele Anfragen (429), bitte später erneut versuchen', status: res.status };
  if (res.status >= 500) return { ok: false, meldung: `Der Dienst meldet einen Serverfehler (${res.status})`, status: res.status };
  return { ok: false, meldung: `Unerwartete Antwort des Dienstes (${res.status})`, status: res.status };
}
