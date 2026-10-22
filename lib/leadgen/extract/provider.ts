import type { ZodType } from 'zod';

// Providerunabhängige Schnittstelle für die LLM-Extraktion (Stufe 5b). Die erste Implementierung steht in openai-provider.ts.
// Das LLM ist nur ein Baustein: es ordnet vorgefundene Werte zu (wer ist Geschäftsführer, welche Nummer ist die Zentrale), was
// im Text nicht steht, wird danach vom Grounding-Check verworfen.

/** Beschreibung einer strukturierten Extraktion: Anweisung, JSON-Schema der Ausgabe und Prüfung der Antwort. */
export type ExtractionSchema<T> = {
  name: string;
  anweisung: string;
  json: Record<string, unknown>;
  parse(roh: unknown): T;
};

export interface ExtractionProvider {
  readonly name: string;
  /** Modell, soweit bekannt (für Protokoll und Kosten) */
  readonly modell: string | null;
  extract<T>(text: string, schema: ExtractionSchema<T>): Promise<T>;
}

export class ExtraktionFehler extends Error {
  constructor(
    message: string,
    public readonly wiederholbar = false,
  ) {
    super(message);
  }
}

/** Baut aus einem zod-Schema ein ExtractionSchema (JSON-Schema für Structured Outputs und Prüfung der Antwort aus einer Quelle). */
export function aus<T>(name: string, anweisung: string, zod: ZodType<T>, jsonSchema: Record<string, unknown>): ExtractionSchema<T> {
  const json = { ...jsonSchema };
  delete json.$schema;
  return {
    name,
    anweisung,
    json,
    parse(roh) {
      const r = zod.safeParse(roh);
      if (!r.success) throw new ExtraktionFehler('Die Antwort der Extraktion entsprach nicht dem Schema.', true);
      return r.data;
    },
  };
}

/** Fester Antwortgeber für Tests und Trockenläufe. */
export class FakeExtractionProvider implements ExtractionProvider {
  readonly name = 'fake';
  readonly modell = null;
  readonly aufrufe: Array<{ schema: string; text: string }> = [];
  constructor(private readonly antwort: (schemaName: string, text: string) => unknown) {}
  async extract<T>(text: string, schema: ExtractionSchema<T>): Promise<T> {
    this.aufrufe.push({ schema: schema.name, text });
    return schema.parse(this.antwort(schema.name, text));
  }
}
