import fs from 'fs';
import readline from 'readline';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { speichereEreignis, type EreignisDaten, type EreignisTyp } from '../ereignisse';
import { parsePerson, normalisiereRolle } from '../normalize/person';
import { registerSchluessel } from '../normalize/register';
import { ordnePersonAufFirma } from '../resolve/resolve';
import { speichereRohdokument } from '../raw-store';
import { istPersonBeiFirmaGesperrt } from '../sperre';
import type { Connector, RawDocument } from '../types';

// Handelsregister-Bekanntmachungen: Geschäftsführerwechsel und Neueintragungen erkennen, als Ereignis speichern und die Personen im
// Register-Bestand nachführen. Die Texte der Bekanntmachungen kommen aus einer Datei (JSONL, rechtmäßig bezogen) oder aus einem
// künftigen Abruf; die Textmuster unten (Bestellt/Ausgeschieden/Neueintragung) sind nicht an einem echten Abruf geprüft.

export const BEKANNTMACHUNG = 'bekanntmachung';

export type Bekanntmachung = {
  registergericht: string;
  registerart: string;
  registernummer: string;
  firma?: string;
  /** Datum der Bekanntmachung (ISO) */
  datum?: string | null;
  text: string;
};

export type BekanntmachungPerson = { name: string; rolle: string };
export type GeparsteBekanntmachung = { neueintragung: boolean; bestellt: BekanntmachungPerson[]; ausgeschieden: BekanntmachungPerson[] };

const ROLLE = '(Gesch(?:ä|ae)ftsf(?:ü|ue)hrer(?:in)?|Vorstand|Vorstandsmitglied|Prokurist(?:in)?|Inhaber(?:in)?)';
/** „Müller, Hans“ (Nachname, Vorname) oder „Hans Müller“; Ort und Geburtsdatum nach dem Komma werden abgeschnitten */
const NAME = '([A-ZÄÖÜ][\\wäöüÄÖÜß.\\- ]{1,40}?,\\s*[A-ZÄÖÜ][\\wäöüÄÖÜß.\\-]+(?: [A-ZÄÖÜ][\\wäöüÄÖÜß.\\-]+)?)';

/**
 * Liest aus dem Text einer Bekanntmachung, wer bestellt wurde und wer ausgeschieden ist. Erkannte Formen: „Bestellt: Geschäftsführer:
 * Müller, Hans, Stuttgart, *01.02.1970“, „Nicht mehr Geschäftsführer: Schmidt, Peter“, „Ausgeschieden: Prokurist: …“, „Neueintragung“.
 */
export function parseBekanntmachung(text: string): GeparsteBekanntmachung {
  const t = text.replace(/\s+/g, ' ');
  const person = (nameRoh: string, rolle: string): BekanntmachungPerson | null => {
    const p = parsePerson(nameRoh.trim().replace(/\s+/g, ' '));
    return p ? { name: [p.vorname, p.nachname].filter(Boolean).join(' '), rolle } : null;
  };
  const sammle = (re: RegExp, rolleGruppe: number, nameGruppe: number): BekanntmachungPerson[] =>
    [...t.matchAll(re)].flatMap((m) => {
      const p = person(m[nameGruppe], m[rolleGruppe] ?? 'Geschäftsführer');
      return p ? [p] : [];
    });
  const bestellt = sammle(new RegExp(`(?:Bestellt|Neu bestellt|Neu|Als)[^:.]{0,30}?:?\\s*${ROLLE}\\s*:?\\s*${NAME}`, 'gi'), 1, 2);
  const ausgeschieden = [
    ...sammle(new RegExp(`Nicht mehr\\s+${ROLLE}\\s*:?\\s*${NAME}`, 'gi'), 1, 2),
    ...sammle(new RegExp(`Ausgeschieden[^:.]{0,30}?:?\\s*${ROLLE}\\s*:?\\s*${NAME}`, 'gi'), 1, 2),
  ];
  const einmal = (l: BekanntmachungPerson[]) => l.filter((p, i) => l.findIndex((q) => q.name === p.name && q.rolle === p.rolle) === i);
  return { neueintragung: /\bNeueintragung\b|\bNeu eingetragen\b/i.test(t), bestellt: einmal(bestellt), ausgeschieden: einmal(ausgeschieden) };
}

/** Bekanntmachungen aus einer lokalen JSONL-Datei (eine Zeile je Bekanntmachung, Felder siehe `Bekanntmachung`). */
export class BekanntmachungenDateiConnector implements Connector {
  readonly quelle = BEKANNTMACHUNG;
  constructor(private readonly datei: string) {}
  async *fetch(): AsyncIterable<RawDocument> {
    const zeilen = readline.createInterface({ input: fs.createReadStream(this.datei), crlfDelay: Infinity });
    for await (const zeile of zeilen) {
      if (!zeile.trim()) continue;
      let b: Bekanntmachung;
      try {
        b = JSON.parse(zeile) as Bekanntmachung;
      } catch {
        continue;
      }
      if (!b?.registernummer || !b.registerart || !b.registergericht || typeof b.text !== 'string') continue;
      yield { quelle: BEKANNTMACHUNG, referenz: `${b.registergericht}|${b.registerart}|${b.registernummer}|${b.datum ?? ''}`, contentType: 'application/json', inhalt: zeile };
    }
  }
}

export type BekanntmachungsErgebnis = { dokumente: number; neu: number; ereignisse: number; unbekannteFirmen: number };

/**
 * Verarbeitet Bekanntmachungen: Rohdokument speichern (nur neue), Ereignis(se) ableiten und speichern, Personen im Bestand nachführen:
 * neu Bestellte werden als Register-Beobachtung der Firma zugeordnet, Ausgeschiedene bekommen eine Beobachtung „ausgeschieden“.
 */
export async function verarbeiteBekanntmachungen(connector: Connector, db: Db = getDb(), jetzt = Date.now()): Promise<BekanntmachungsErgebnis> {
  const erg: BekanntmachungsErgebnis = { dokumente: 0, neu: 0, ereignisse: 0, unbekannteFirmen: 0 };
  for await (const doc of connector.fetch()) {
    erg.dokumente++;
    let b: Bekanntmachung;
    try {
      b = JSON.parse(doc.inhalt) as Bekanntmachung;
    } catch {
      continue;
    }
    db.transaction((tx) => {
      const t = tx as unknown as Db;
      const { id, neu } = speichereRohdokument(doc, t);
      if (!neu) return;
      erg.neu++;
      const key = registerSchluessel({ art: b.registerart, nummer: b.registernummer, gericht: b.registergericht });
      const firma = key ? t.select().from(schema.companies).where(eq(schema.companies.registerKey, key)).get() : undefined;
      if (!firma) erg.unbekannteFirmen++;
      const p = parseBekanntmachung(b.text);
      const datum = b.datum ?? null;
      const beobachtetAm = datum && Number.isFinite(Date.parse(datum)) ? Date.parse(datum) : jetzt;
      const basis: EreignisDaten = { firma: firma?.name ?? b.firma, registerKey: key, datum };
      const events: Array<{ typ: EreignisTyp; daten: EreignisDaten }> = [];
      const entscheider = (l: BekanntmachungPerson[]) => l.filter((x) => normalisiereRolle(x.rolle) !== 'prokurist' && normalisiereRolle(x.rolle) !== 'sonstige');
      const neuE = entscheider(p.bestellt);
      const wegE = entscheider(p.ausgeschieden);
      if (p.neueintragung) events.push({ typ: 'neueintragung', daten: { ...basis, neu: neuE } });
      else if (neuE.length && wegE.length) events.push({ typ: 'gf_wechsel', daten: { ...basis, neu: neuE, alt: wegE } });
      else if (neuE.length) events.push({ typ: 'gf_neu', daten: { ...basis, neu: neuE } });
      else if (wegE.length) events.push({ typ: 'gf_ausgeschieden', daten: { ...basis, alt: wegE } });
      for (const e of events) if (speichereEreignis({ quelle: BEKANNTMACHUNG, referenz: doc.referenz, typ: e.typ, daten: e.daten, companyId: firma?.id ?? null }, t)) erg.ereignisse++;

      // Personen im Bestand nachführen (nur wenn die Firma bekannt ist)
      if (!firma) return;
      for (const x of p.bestellt) {
        const pp = parsePerson(x.name, x.rolle);
        if (!pp || istPersonBeiFirmaGesperrt(t, pp, firma.id)) continue;
        const z = ordnePersonAufFirma(t, firma.id, pp, BEKANNTMACHUNG, doc.referenz);
        if (z) t.insert(schema.attributeObservations).values({ entityType: 'person', entityId: z.personId, feld: 'person', wert: { ...pp, url: null }, quelle: 'handelsregister', rawDocumentId: id, konfidenz: 0.95, beobachtetAm: new Date(beobachtetAm) }).run();
      }
      for (const x of p.ausgeschieden) {
        const pp = parsePerson(x.name, x.rolle);
        if (!pp) continue;
        const bestand = t.select().from(schema.persons).where(and(eq(schema.persons.companyId, firma.id), eq(schema.persons.nachname, pp.nachname))).all();
        for (const person of bestand) {
          if (pp.vorname && person.vorname && person.vorname.toLowerCase() !== pp.vorname.toLowerCase()) continue;
          t.update(schema.persons).set({ rolle: 'ausgeschieden', rolleText: 'ausgeschieden (Handelsregister)' }).where(eq(schema.persons.id, person.id)).run();
          t.insert(schema.attributeObservations).values({ entityType: 'person', entityId: person.id, feld: 'person_ausgeschieden', wert: { rolle: x.rolle, datum }, quelle: 'handelsregister', rawDocumentId: id, konfidenz: 0.95, beobachtetAm: new Date(beobachtetAm) }).run();
        }
      }
    });
  }
  return erg;
}
