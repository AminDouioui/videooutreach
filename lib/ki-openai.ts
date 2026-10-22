import { getEnv } from './env';
import { kiModell, kiSchluessel } from './settings';
import { KI_ZEITLIMIT_MS, KiFehler, type KiClient } from './ki';

// OpenAI als Anbieter für Texte/Entwürfe (Antwort-Entwurf, Schreibhilfe): POST {OPENAI_BASE_URL}/responses (Responses API,
// die aktuelle Schnittstelle von OpenAI; nur fetch, keine Abhängigkeit). Der Client hat dieselbe Form wie der Anthropic-Client
// (KiClient: liefert den JSON-Text einer strukturierten Ausgabe), daher laufen entwerfeAntwort/schlageVorlageVor unverändert.
// Es wird nichts geloggt; Mailinhalte stehen weder in Logs noch in Fehlermeldungen.

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Text der Antwort tolerant lesen: `output_text`, sonst output[].content[].text (type output_text), sonst Chat-Form */
export function leseOpenAiText(json: unknown): string | null {
  if (!istObjekt(json)) return null;
  if (typeof json.output_text === 'string' && json.output_text.trim()) return json.output_text;
  const teile: string[] = [];
  if (Array.isArray(json.output)) {
    for (const o of json.output) {
      if (!istObjekt(o) || !Array.isArray(o.content)) continue;
      for (const c of o.content) if (istObjekt(c) && typeof c.text === 'string' && (c.type === undefined || c.type === 'output_text' || c.type === 'text')) teile.push(c.text);
    }
  }
  if (teile.length) return teile.join('');
  const chat = Array.isArray(json.choices) && istObjekt(json.choices[0]) && istObjekt(json.choices[0].message) ? json.choices[0].message.content : null;
  return typeof chat === 'string' && chat.trim() ? chat : null;
}

async function httpFehler(res: Response): Promise<KiFehler> {
  // Nur Fehlercode/-typ der API auswerten, nie Text ausgeben (kann Eingaben zitieren)
  const body: unknown = await res.json().catch(() => null);
  const err = istObjekt(body) && istObjekt(body.error) ? body.error : {};
  const code = `${typeof err.code === 'string' ? err.code : ''} ${typeof err.type === 'string' ? err.type : ''}`;
  const s = res.status;
  if (code.includes('insufficient_quota')) return new KiFehler('Das OpenAI-Guthaben bzw. Kontingent ist aufgebraucht (insufficient_quota). Bitte Abrechnung bei OpenAI prüfen.', 'guthaben');
  if (code.includes('model_not_found') || s === 404) return new KiFehler('Das OpenAI-Modell wurde nicht gefunden (model not found). Bitte das Modell (Einstellungen → KI bzw. OPENAI_MODEL) prüfen, siehe platform.openai.com/docs/models.', 'anfrage');
  if (s === 401 || s === 403) return new KiFehler('Der OpenAI-API-Schlüssel ist ungültig oder hat keine Berechtigung. Bitte den Schlüssel unter Einstellungen → KI (bzw. OPENAI_API_KEY) prüfen.', 'schluessel');
  if (s === 429) return new KiFehler('OpenAI meldet zu viele Anfragen (Rate-Limit). Bitte in einer Minute erneut versuchen.', 'limit', true);
  if (s >= 500) return new KiFehler(`Der OpenAI-Dienst hat einen Serverfehler gemeldet (${s}). Bitte später erneut versuchen.`, 'ueberlast', true);
  return new KiFehler(`OpenAI hat die Anfrage abgelehnt (${s}).`, 'anfrage');
}

/** Client über die Responses API. `f` ist injizierbar (Tests). Das Modell kommt aus `modell`, sonst aus der Einstellung (sonst OPENAI_MODEL). */
export function openaiClient(f: typeof fetch = fetch, modell?: string): KiClient {
  return async (a) => {
    const env = getEnv();
    const key = kiSchluessel('openai');
    if (!key) throw new KiFehler('OpenAI ist nicht aktiviert (kein OpenAI-Schlüssel hinterlegt).', 'deaktiviert');
    let res: Response;
    try {
      res = await f(`${env.OPENAI_BASE_URL.replace(/\/+$/, '')}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modell ?? kiModell('openai'),
          instructions: a.system,
          input: a.nutzer,
          // Großzügig, weil Denk-Tokens mitzählen
          max_output_tokens: Math.max(a.maxTokens * 4, 4000),
          text: { format: { type: 'json_schema', name: 'antwort', schema: a.schema, strict: true } },
        }),
        signal: AbortSignal.timeout(KI_ZEITLIMIT_MS),
      });
    } catch (e) {
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new KiFehler('Der KI-Dienst hat nicht rechtzeitig geantwortet (Zeitüberschreitung). Bitte erneut versuchen.', 'zeit', true);
      }
      throw new KiFehler('Keine Verbindung zum KI-Dienst (Internet oder Proxy prüfen).', 'verbindung', true);
    }
    if (!res.ok) throw await httpFehler(res);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new KiFehler(`Die OpenAI-Antwort (HTTP ${res.status}) war kein gültiges JSON. Bitte erneut versuchen.`, 'antwort', true);
    }
    if (istObjekt(json) && json.status === 'incomplete') throw new KiFehler('Die KI-Antwort wurde abgeschnitten. Bitte erneut versuchen.', 'antwort', true);
    const refusal = istObjekt(json) && Array.isArray(json.output) && json.output.some((o) => istObjekt(o) && Array.isArray(o.content) && o.content.some((c) => istObjekt(c) && c.type === 'refusal'));
    if (refusal) throw new KiFehler('Die KI hat diese Anfrage aus Sicherheitsgründen abgelehnt.', 'antwort');
    const text = leseOpenAiText(json);
    if (!text) throw new KiFehler(`Die OpenAI-Antwort (HTTP ${res.status}) hatte ein unbekanntes Format. Bitte erneut versuchen.`, 'antwort', true);
    return text;
  };
}
