import fs from 'fs';
import readline from 'readline';
import zlib from 'zlib';
import { parseAdresse } from '../normalize/adresse';
import { trenneFirma } from '../normalize/firma';
import { parsePerson } from '../normalize/person';
import { parseRegister } from '../normalize/register';
import type { Connector, NormalisierterSatz, RawDocument } from '../types';

// OffeneRegister.de (Bulk-Dump der Handelsregisterdaten, CC0) als Startbestand. Achtung: der Datenstand ist alt (um 2019), die Daten
// dienen nur als Seed und werden von jüngeren Quellen überstimmt (siehe Survivorship in Phase 5), nie als Wahrheit behandelt.
//
// Eingabe: JSON Lines (eine Firma je Zeile), auch .gz. Der Dump ist als .bz2 verteilt: vorher mit `bunzip2` entpacken.
// Feldformat laut veröffentlichten Beispielsätzen (CedarDB-Doku zum Dump): company_number („K1101R_HRB150148“), name, current_status,
// jurisdiction_code, registered_address, retrieved_at, all_attributes{native_company_number („Hamburg HRB 150148“), registrar,
// registered_office, federal_state, _registerArt, _registerNummer, additional_data}, officers[{name, position, type, start_date, city}].
// Nicht an einem vollständigen Dump geprüft (hier kein Zugriff); fehlende oder abweichende Felder werden toleriert, nie geraten.

export const OFFENEREGISTER = 'offeneregister';

export type OffeneRegisterOptionen = {
  datei: string;
  /** Nur Datensätze übernehmen, für die der Filter true liefert (der Dump hat Millionen Firmen, in die DB gehört nur die Zielgruppe) */
  filter?: (satz: Record<string, unknown>) => boolean;
  /** Höchstens so viele Dokumente liefern */
  limit?: number;
};

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const text = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);

export class OffeneRegisterConnector implements Connector {
  readonly quelle = OFFENEREGISTER;
  constructor(private readonly opt: OffeneRegisterOptionen) {}

  async *fetch(): AsyncIterable<RawDocument> {
    const roh = fs.createReadStream(this.opt.datei);
    const strom = this.opt.datei.endsWith('.gz') ? roh.pipe(zlib.createGunzip()) : roh;
    const zeilen = readline.createInterface({ input: strom, crlfDelay: Infinity });
    let n = 0;
    for await (const zeile of zeilen) {
      if (!zeile.trim()) continue;
      let satz: unknown;
      try {
        satz = JSON.parse(zeile);
      } catch {
        continue; // Defekte Zeile überspringen, der Rest des Dumps bleibt nutzbar
      }
      if (!istObjekt(satz)) continue;
      const referenz = text(satz.company_number) ?? text(istObjekt(satz.all_attributes) ? satz.all_attributes.native_company_number : null);
      if (!referenz || !text(satz.name)) continue;
      if (this.opt.filter && !this.opt.filter(satz)) continue;
      yield { quelle: OFFENEREGISTER, referenz, contentType: 'application/json', inhalt: zeile };
      if (this.opt.limit && ++n >= this.opt.limit) break;
    }
  }
}

/** Normalisiert ein OffeneRegister-Rohdokument (Stufe 2). Gibt null zurück, wenn der Satz unbrauchbar ist. */
export function normalisiereOffeneRegister(doc: RawDocument): NormalisierterSatz | null {
  let satz: unknown;
  try {
    satz = JSON.parse(doc.inhalt);
  } catch {
    return null;
  }
  if (!istObjekt(satz)) return null;
  const name = text(satz.name);
  if (!name) return null;
  const attr = istObjekt(satz.all_attributes) ? satz.all_attributes : {};
  const firma = trenneFirma(name);
  // „native_company_number“ hat die Form „Hamburg HRB 150148“; _registerArt/_registerNummer/registrar sind getrennte Felder derselben Angabe
  const regText = parseRegister(text(attr.native_company_number) ?? text(satz.company_number));
  const reg = { art: regText.art ?? text(attr._registerArt), nummer: regText.nummer ?? text(attr._registerNummer), gericht: regText.gericht ?? text(attr.registrar) };
  const adresse = parseAdresse(text(satz.registered_address) ?? text(attr.registered_address), text(attr.federal_state));
  const personen = (Array.isArray(satz.officers) ? satz.officers : [])
    .filter(istObjekt)
    // Beteiligte Unternehmen (z. B. Komplementär-GmbH) sind keine Ansprechpartner
    .filter((o) => o.type !== 'company')
    .filter((o) => !o.end_date)
    .map((o) => parsePerson(text(o.name) ?? '', text(o.position)))
    .filter((p) => p !== null);
  return {
    quelle: doc.quelle,
    referenz: doc.referenz,
    name: firma.name,
    rechtsform: firma.rechtsform,
    nameNormalized: firma.nameNormalized,
    registerart: reg.art,
    registernummer: reg.nummer,
    registergericht: reg.gericht,
    sitz: text(attr._registered_office) ?? text(attr.registered_office) ?? adresse?.ort ?? null,
    adresse,
    status: text(satz.current_status),
    personen,
    // Datenstand laut Dump (Abrufzeitpunkt der Registerdaten): so zerfallen die Angaben des alten Bestands von Anfang an
    datenStand: ((): number | null => {
      const t = text(satz.retrieved_at);
      const ms = t ? Date.parse(t) : NaN;
      return Number.isFinite(ms) && ms > 0 && ms <= Date.now() ? ms : null;
    })(),
  };
}
