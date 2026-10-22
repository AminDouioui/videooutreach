import { sql } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import { normalisiereOffeneRegister, OFFENEREGISTER } from './connectors/offeneregister';
import { speichereRohdokument } from './raw-store';
import type { Connector, NeueBeobachtung, NormalisierterSatz, RawDocument } from './types';

// Stufe 1 + 2: Rohdokument speichern, normalisieren und als Beobachtungen ablegen

/** Wie verlässlich eine Quelle für ihre Felder ist (Survivorship in Phase 5 nutzt zusätzlich eigene Regeln je Feld) */
export const QUELLEN_KONFIDENZ: Record<string, number> = { [OFFENEREGISTER]: 0.7, handelsregister: 0.95 };

export type Normalisierer = (doc: RawDocument) => NormalisierterSatz | null;

/** Normalisierer je Quelle; ein neuer Connector (z. B. North Data) trägt hier seinen Normalisierer ein. */
export const NORMALISIERER: Record<string, Normalisierer> = { [OFFENEREGISTER]: normalisiereOffeneRegister };

/** Übersetzt einen normalisierten Satz in einzelne Feldbeobachtungen (jede mit Herkunft; Personen als eigene Beobachtung). */
export function beobachtungenAus(satz: NormalisierterSatz, konfidenz: number): NeueBeobachtung[] {
  const firma = (feld: string, wert: unknown): NeueBeobachtung[] => (wert === null || wert === undefined || wert === '' ? [] : [{ entityType: 'company', feld, wert, konfidenz }]);
  const a = satz.adresse;
  return [
    ...firma('name', satz.name),
    ...firma('rechtsform', satz.rechtsform),
    ...firma('name_normalized', satz.nameNormalized),
    ...firma('registerart', satz.registerart),
    ...firma('registernummer', satz.registernummer),
    ...firma('registergericht', satz.registergericht),
    ...firma('sitz', satz.sitz),
    ...firma('status', satz.status),
    ...firma('strasse', a?.strasse),
    ...firma('plz', a?.plz),
    ...firma('ort', a?.ort),
    // Ein aus der PLZ abgeleitetes Bundesland ist unsicherer als eines aus der Quelle
    ...(a?.bundesland ? [{ entityType: 'company' as const, feld: 'bundesland', wert: a.bundesland, konfidenz: a.bundeslandHerkunft === 'quelle' ? konfidenz : Math.min(konfidenz, 0.6) }] : []),
    ...satz.personen.map((p): NeueBeobachtung => ({ entityType: 'person', feld: 'person', wert: p, konfidenz })),
  ];
}

export type IngestErgebnis = { dokumente: number; neu: number; unbrauchbar: number; beobachtungen: number };

/**
 * Liest alle Dokumente des Connectors. Neue Versionen werden normalisiert und als Beobachtungen gespeichert; ein unveränderter
 * Inhalt ändert nichts (idempotent). `normalisierer` überschreibt den Standard der Quelle (Tests).
 */
export async function ingestQuelle(connector: Connector, db: Db = getDb(), normalisierer?: Normalisierer): Promise<IngestErgebnis> {
  const norm = normalisierer ?? NORMALISIERER[connector.quelle];
  if (!norm) throw new Error(`Kein Normalisierer für die Quelle "${connector.quelle}" registriert.`);
  const konfidenz = QUELLEN_KONFIDENZ[connector.quelle] ?? 0.5;
  const erg: IngestErgebnis = { dokumente: 0, neu: 0, unbrauchbar: 0, beobachtungen: 0 };
  for await (const doc of connector.fetch()) {
    erg.dokumente++;
    db.transaction((tx) => {
      const { id, neu } = speichereRohdokument(doc, tx as unknown as Db);
      if (!neu) return;
      erg.neu++;
      const satz = norm(doc);
      if (!satz) {
        erg.unbrauchbar++;
        return;
      }
      for (const b of beobachtungenAus(satz, konfidenz)) {
        tx.insert(schema.attributeObservations)
          .values({ entityType: b.entityType, feld: b.feld, wert: b.wert, quelle: doc.quelle, rawDocumentId: id, konfidenz: b.konfidenz, typ: b.typ ?? 'exakt' })
          .run();
        erg.beobachtungen++;
      }
    });
  }
  return erg;
}

export type Kennzahlen = { firmen: number; mitGeschaeftsfuehrer: number; mitVerifizierterEmail: number };

/**
 * Kennzahl am Ende jeder Phase: wie viele Firmen (je Quelle und Referenz einmal gezählt, unabhängig von der Anzahl Versionen),
 * wie viele davon mit Geschäftsführer/Vorstand und wie viele mit verifizierter E-Mail (gibt es ab Phase 4).
 */
export function ladeKennzahlen(db: Db = getDb()): Kennzahlen {
  const zahl = (q: ReturnType<typeof sql>) => (db.all<{ n: number }>(q)[0]?.n ?? 0);
  const firmen = zahl(sql`select count(distinct r.quelle || '|' || r.referenz) as n from attribute_observations o join raw_documents r on r.id = o.raw_document_id where o.entity_type = 'company' and o.feld = 'name'`);
  const mitGf = zahl(
    sql`select count(distinct r.quelle || '|' || r.referenz) as n from attribute_observations o join raw_documents r on r.id = o.raw_document_id where o.entity_type = 'person' and o.feld = 'person' and json_extract(o.wert, '$.rolle') in ('geschaeftsfuehrer', 'vorstand', 'inhaber')`,
  );
  const mitEmail = zahl(sql`select count(distinct o.entity_id) as n from attribute_observations o where o.entity_type = 'contact_point' and o.feld = 'email' and json_extract(o.wert, '$.status') = 'gueltig'`);
  return { firmen, mitGeschaeftsfuehrer: mitGf, mitVerifizierterEmail: mitEmail };
}
