import { createHash } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/lib/db';
import type { RawDocument } from './types';

// Rohdaten-Schicht: unverändert speichern, nur neu versionieren (anderer Inhalt = neue Zeile, nie UPDATE)

export function inhaltHash(inhalt: string): string {
  return createHash('sha256').update(inhalt).digest('hex');
}

/** Speichert das Dokument; ist genau dieser Inhalt für diese Quelle und Referenz schon da, entsteht keine zweite Zeile (`neu` = false). */
export function speichereRohdokument(doc: RawDocument, db: Db = getDb()): { id: number; neu: boolean } {
  const hash = inhaltHash(doc.inhalt);
  const res = db
    .insert(schema.rawDocuments)
    .values({ quelle: doc.quelle, referenz: doc.referenz, url: doc.url ?? null, contentType: doc.contentType ?? 'application/json', inhalt: doc.inhalt, inhaltHash: hash })
    .onConflictDoNothing()
    .returning({ id: schema.rawDocuments.id })
    .get();
  if (res) return { id: res.id, neu: true };
  const vorhanden = db
    .select({ id: schema.rawDocuments.id })
    .from(schema.rawDocuments)
    .where(and(eq(schema.rawDocuments.quelle, doc.quelle), eq(schema.rawDocuments.referenz, doc.referenz), eq(schema.rawDocuments.inhaltHash, hash)))
    .get();
  return { id: vorhanden!.id, neu: false };
}

/** Neueste Version eines Dokuments (z. B. für Cache-Entscheidungen der Connectors) oder null. */
export function neuesterStand(quelle: string, referenz: string, db: Db = getDb()) {
  return db
    .select()
    .from(schema.rawDocuments)
    .where(and(eq(schema.rawDocuments.quelle, quelle), eq(schema.rawDocuments.referenz, referenz)))
    .orderBy(schema.rawDocuments.abgerufenAm, schema.rawDocuments.id)
    .all()
    .at(-1) ?? null;
}
