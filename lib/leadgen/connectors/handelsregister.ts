import { neuesterStand } from '../raw-store';
import type { Connector, RawDocument } from '../types';

// Handelsregister (handelsregister.de). Es gibt keine offizielle API, und die Nutzungsbedingungen beschränken automatisierte
// Abrufe stark. Deshalb: standardmäßig AUS (LEADGEN_HR_LIVE=1 nötig), strikt gedrosselt, jede Antwort wird gecacht, und der
// eigentliche HTTP-Abruf ist austauschbar (`abruf`). Ein echter Abruf ist bewusst noch NICHT eingebaut: Formularparameter und
// Antwortformat sind ohne Zugriff auf die Seite nicht verifiziert, und die Nutzungsbedingungen müssen vorher geprüft werden.

export const HANDELSREGISTER = 'handelsregister';

/** Standard: höchstens 60 Abfragen pro Stunde (Grenze der Betreiber), gleichmäßig verteilt */
export const HR_MIN_ABSTAND_MS = 60_000;
/** Ein bereits abgerufener Registerstand gilt so lange, ohne neu angefragt zu werden */
export const HR_CACHE_MS = 7 * 24 * 3600_000;

export type HrAbfrage = { registergericht: string; registerart: string; registernummer: string };
export type HrAbruf = (a: HrAbfrage) => Promise<{ inhalt: string; url?: string; contentType?: string }>;

export class HandelsregisterDeaktiviert extends Error {
  constructor() {
    super('Der Handelsregister-Abruf ist deaktiviert (LEADGEN_HR_LIVE=1 setzen, nachdem die Nutzungsbedingungen geprüft sind).');
  }
}

export type HandelsregisterOptionen = {
  abfragen: HrAbfrage[];
  /** Muss ausdrücklich gesetzt werden; Standard: aus */
  aktiv?: boolean;
  abruf?: HrAbruf;
  minAbstandMs?: number;
  jetzt?: () => number;
  warte?: (ms: number) => Promise<void>;
};

export class HandelsregisterConnector implements Connector {
  readonly quelle = HANDELSREGISTER;
  private letzterAbruf = 0;
  constructor(private readonly opt: HandelsregisterOptionen) {}

  async *fetch(): AsyncIterable<RawDocument> {
    // Ausdrücklich freigegeben (Option oder LEADGEN_HR_LIVE=1), sonst aus
    if (!(this.opt.aktiv ?? process.env.LEADGEN_HR_LIVE === '1')) throw new HandelsregisterDeaktiviert();
    const jetzt = this.opt.jetzt ?? Date.now;
    const warte = this.opt.warte ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const abstand = this.opt.minAbstandMs ?? HR_MIN_ABSTAND_MS;
    for (const a of this.opt.abfragen) {
      const referenz = `${a.registergericht}|${a.registerart}|${a.registernummer}`;
      // Cache: frisch Abgerufenes nicht noch einmal anfragen (kostet kein Kontingent)
      const stand = neuesterStand(HANDELSREGISTER, referenz);
      if (stand && jetzt() - stand.abgerufenAm.getTime() < HR_CACHE_MS) {
        yield { quelle: HANDELSREGISTER, referenz, url: stand.url ?? undefined, contentType: stand.contentType, inhalt: stand.inhalt };
        continue;
      }
      if (!this.opt.abruf) throw new Error('Kein Abruf für das Handelsregister konfiguriert (noch nicht implementiert).');
      const warten = this.letzterAbruf + abstand - jetzt();
      if (warten > 0) await warte(warten);
      this.letzterAbruf = jetzt();
      const antwort = await this.opt.abruf(a);
      yield { quelle: HANDELSREGISTER, referenz, url: antwort.url, contentType: antwort.contentType ?? 'text/html', inhalt: antwort.inhalt };
    }
  }
}
