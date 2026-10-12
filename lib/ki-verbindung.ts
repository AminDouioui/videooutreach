import { getEnv } from './env';
import { kiModell, kiSchluessel, type KiAnbieter } from './settings';

// Verbindungstest für einen KI-Schlüssel: ein minimaler lesender Aufruf (Modell-/Schlüsselinfo, keine Kosten, keine Mailinhalte).
// Der Schlüssel wird nur im Authorization-Header gesendet; er steht weder in der Antwort noch in Logs.

export const VERBINDUNGSTEST_ZEITLIMIT_MS = 10_000;

export type VerbindungsErgebnis = { ok: boolean; meldung: string; status?: number; modelle?: string[] };

function basis(url: string): string {
  return url.replace(/\/+$/, '');
}

/** URL und Header des Testaufrufs je Anbieter */
function anfrage(anbieter: KiAnbieter, schluessel: string): { url: string; headers: Record<string, string> } {
  const env = getEnv();
  // TypeSafe direkt: GET /v1/models verlangt den Schlüssel (401/403 = ungültig) und listet die verfügbaren Jev-Modelle
  if (anbieter === 'typesafe') return { url: `${basis(env.TYPESAFE_BASE_URL)}/v1/models`, headers: { Authorization: `Bearer ${schluessel}` } };
  if (anbieter === 'openai') return { url: `${basis(env.OPENAI_BASE_URL)}/models`, headers: { Authorization: `Bearer ${schluessel}` } };
  // OpenRouter: /v1/key liefert Infos zum Schlüssel und verlangt ihn (die Modellliste /v1/models ist öffentlich und würde jeden Wert akzeptieren)
  if (anbieter === 'openrouter') return { url: `${basis(env.JEV_BASE_URL)}/v1/key`, headers: { Authorization: `Bearer ${schluessel}` } };
  const anthropicBasis = basis(process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com');
  return { url: `${anthropicBasis}/v1/models?limit=1`, headers: { 'x-api-key': schluessel, 'anthropic-version': '2023-06-01' } };
}

/** Modellnamen aus der Antwort von GET /v1/models lesen; das Format ist nicht verbindlich bekannt, daher tolerant (Liste oder {data|models: Liste} aus Strings bzw. Objekten mit id/name/model) */
export function leseModellnamen(json: unknown): string[] {
  const liste = Array.isArray(json) ? json : typeof json === 'object' && json !== null ? ((json as Record<string, unknown>).data ?? (json as Record<string, unknown>).models) : null;
  if (!Array.isArray(liste)) return [];
  const namen = liste.map((x) => {
    if (typeof x === 'string') return x;
    if (typeof x === 'object' && x !== null) {
      const o = x as Record<string, unknown>;
      return [o.id, o.name, o.model].find((n): n is string => typeof n === 'string');
    }
    return undefined;
  });
  return [...new Set(namen.filter((n): n is string => !!n && n.length <= 100))];
}

/** Ist das konfigurierte Modell in der Liste? „jev-1.13“ passt auf „jev-1.13.0“; ein „…-latest“-Alias gilt, sobald es ein Modell derselben Familie gibt */
export function modellVorhanden(modell: string, liste: string[]): boolean {
  if (liste.includes(modell)) return true;
  if (liste.some((m) => m.startsWith(`${modell}.`))) return true;
  const familie = modell.replace(/-latest$/, '');
  return familie !== modell && liste.some((m) => m === familie || m.startsWith(`${familie}-`));
}

async function typesafeErgebnis(res: Response): Promise<VerbindungsErgebnis> {
  let modelle: string[] = [];
  try {
    modelle = leseModellnamen(await res.json());
  } catch {
    /* Format unbekannt: Schlüssel ist trotzdem gültig */
  }
  if (!modelle.length) return { ok: true, meldung: 'Schlüssel gültig', status: res.status };
  const modell = kiModell('typesafe');
  const verfuegbar = `Verfügbare Modelle: ${modelle.slice(0, 15).join(', ')}${modelle.length > 15 ? ' …' : ''}`;
  const warnung = modellVorhanden(modell, modelle) ? '' : `. Achtung: Das eingestellte Modell „${modell}“ steht nicht in der Liste, bitte eines der genannten eintragen`;
  return { ok: true, meldung: `Schlüssel gültig. ${verfuegbar}${warnung}`, status: res.status, modelle };
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
  // Antwortkörper nicht weitergeben (nur bei TypeSafe: Modellnamen auslesen)
  if (res.ok && anbieter === 'typesafe') return typesafeErgebnis(res);
  void res.body?.cancel().catch(() => {});
  if (res.ok) return { ok: true, meldung: 'Schlüssel gültig', status: res.status };
  if (res.status === 401 || res.status === 403) return { ok: false, meldung: `Schlüssel ungültig (${res.status})`, status: res.status };
  if (res.status === 429) return { ok: false, meldung: 'Schlüssel nicht prüfbar: zu viele Anfragen (429), bitte später erneut versuchen', status: res.status };
  if (res.status >= 500) return { ok: false, meldung: `Der Dienst meldet einen Serverfehler (${res.status})`, status: res.status };
  return { ok: false, meldung: `Unerwartete Antwort des Dienstes (${res.status})`, status: res.status };
}
