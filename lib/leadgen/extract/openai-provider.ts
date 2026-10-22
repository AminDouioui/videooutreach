import { getEnv } from '@/lib/env';
import { KiFehler, type KiClient } from '@/lib/ki';
import { openaiClient } from '@/lib/ki-openai';
import { getSetting, kiModell } from '@/lib/settings';
import { protokolliereKosten } from '../kosten';
import { ExtraktionFehler, type ExtractionProvider, type ExtractionSchema } from './provider';

// Erste Implementierung des ExtractionProvider: OpenAI (vorhandener Schlüssel aus Einstellungen/.env) mit Structured Outputs.
// Das Modell ist konfigurierbar (Einstellung `extraktion_modell`, sonst LEADGEN_EXTRAKTION_MODELL, sonst das KI-Standardmodell).

const MAX_EINGABE_ZEICHEN = 14_000;

const SYSTEM_REGELN =
  'Du extrahierst Angaben aus dem Text einer Firmenwebseite. Gib nur Werte zurück, die WÖRTLICH im Text stehen. ' +
  'Erfinde nichts, ergänze nichts, rate nicht. Wenn eine Angabe fehlt oder unklar ist, lasse sie weg bzw. setze null. ' +
  'Antworte ausschließlich im vorgegebenen JSON-Schema.';

export function extraktionsModell(): string {
  return getSetting('extraktion_modell')?.trim() || getEnv().LEADGEN_EXTRAKTION_MODELL || kiModell('openai');
}

export class OpenAiExtractionProvider implements ExtractionProvider {
  readonly name = 'openai';
  readonly modell: string;
  private readonly client: KiClient;

  constructor(private readonly opt: { client?: KiClient; modell?: string; runId?: number | null } = {}) {
    this.modell = opt.modell ?? extraktionsModell();
    this.client = opt.client ?? openaiClient(fetch, this.modell);
  }

  async extract<T>(text: string, schema: ExtractionSchema<T>): Promise<T> {
    const system = `${SYSTEM_REGELN}\n\n${schema.anweisung}`;
    const nutzer = text.slice(0, MAX_EINGABE_ZEICHEN);
    let antwort: string;
    try {
      antwort = await this.client({ modell: this.modell, system, nutzer, schema: schema.json, maxTokens: 1500, effort: 'low' });
    } catch (e) {
      if (e instanceof KiFehler) throw new ExtraktionFehler(e.message, e.wiederholbar);
      throw e;
    }
    // Kosten schätzen (die Antwort liefert keine Token-Zahlen): grob 4 Zeichen je Token, Preise aus der Konfiguration (leer = 0)
    const ein = Math.ceil((system.length + nutzer.length) / 4);
    const aus = Math.ceil(antwort.length / 4);
    const env = getEnv();
    protokolliereKosten({ runId: this.opt.runId ?? null, anbieter: 'openai', art: `extraktion:${schema.name}`, einheiten: ein + aus, kostenMilliCent: ((env.LEADGEN_LLM_PREIS_EIN ?? 0) * ein + (env.LEADGEN_LLM_PREIS_AUS ?? 0) * aus) / 1000 });
    let roh: unknown;
    try {
      roh = JSON.parse(antwort);
    } catch {
      throw new ExtraktionFehler('Die Antwort der Extraktion war kein gültiges JSON.', true);
    }
    return schema.parse(roh);
  }
}
