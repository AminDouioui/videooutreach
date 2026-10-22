import type { Connector, RawDocument } from '../types';

// Platzhalter für einen späteren bezahlten Anbieter (z. B. North Data API). Er erfüllt dasselbe Connector-Interface wie die
// übrigen Quellen und lässt sich deshalb ohne Umbau einstecken: Abruf in `fetch()` ergänzen, passenden Normalisierer in der
// Ingestion registrieren.

export const NORTHDATA = 'northdata';

export class NorthDataNichtKonfiguriert extends Error {
  constructor() {
    super('North Data ist nicht konfiguriert (kein API-Zugang hinterlegt, Anbindung noch nicht implementiert).');
  }
}

export class NorthDataConnector implements Connector {
  readonly quelle = NORTHDATA;
  async *fetch(): AsyncIterable<RawDocument> {
    throw new NorthDataNichtKonfiguriert();
  }
}
