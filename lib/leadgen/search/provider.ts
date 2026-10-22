// Search-API als austauschbarer Provider (Domain-Ermittlung, Personensuche). Die erste Implementierung ist Brave (brave.ts).

export type SuchTreffer = { titel: string; url: string; snippet: string };

export type SuchOptionen = { anzahl?: number; land?: string; sprache?: string };

export interface SearchProvider {
  readonly name: string;
  suche(anfrage: string, opt?: SuchOptionen): Promise<SuchTreffer[]>;
}

export class SuchFehler extends Error {
  constructor(
    message: string,
    public readonly wiederholbar = false,
  ) {
    super(message);
  }
}

/** Fester Antwortgeber für Tests und Trockenläufe. */
export class FakeSearchProvider implements SearchProvider {
  readonly name = 'fake';
  readonly anfragen: string[] = [];
  constructor(private readonly antworten: (anfrage: string) => SuchTreffer[]) {}
  async suche(anfrage: string): Promise<SuchTreffer[]> {
    this.anfragen.push(anfrage);
    return this.antworten(anfrage);
  }
}
