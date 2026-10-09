import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { emailDomain } from './lead-status';

// Sperrliste (kampagnenübergreifend) und Abmeldung

export function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}

/** Einträge, die mit '@' beginnen (z. B. '@firma.de'), sperren die ganze Domain. */
export function istDomainEintrag(eintrag: string): boolean {
  return normalizeEmail(eintrag).startsWith('@');
}

/** Sperrlisten-Eintrag der Domain einer Adresse ('@firma.de') oder null. */
export function domainEintragFuer(email: string): string | null {
  const d = emailDomain(normalizeEmail(email));
  return d ? `@${d}` : null;
}

/** Ist die Adresse oder ihre ganze Domain gesperrt? */
export function isSuppressed(email: string): boolean {
  const e = normalizeEmail(email);
  const domain = domainEintragFuer(e);
  const eintraege = domain ? [e, domain] : [e];
  const row = getDb().select().from(schema.suppressionList).where(inArray(schema.suppressionList.email, eintraege)).get();
  return !!row;
}

export function listSuppression() {
  return getDb().select().from(schema.suppressionList).orderBy(sql`${schema.suppressionList.createdAt} desc`).all();
}

/** Setzt alle ausstehenden Mails an diese Adresse (bei '@domain' an die ganze Domain) auf „übersprungen“. */
export function skipPendingFor(email: string, grund: string): number {
  const e = normalizeEmail(email);
  const ziel = istDomainEintrag(e) ? sql`substr(lower(${schema.leads.email}), -${e.length}) = ${e}` : eq(schema.leads.email, e);
  const res = getDb()
    .update(schema.leads)
    .set({ sendStatus: 'uebersprungen', sendError: grund })
    .where(and(ziel, inArray(schema.leads.sendStatus, ['nicht_gesendet', 'geplant'])))
    .run();
  return res.changes;
}

export function addSuppression(email: string, reason: string): void {
  const e = normalizeEmail(email);
  getDb().insert(schema.suppressionList).values({ email: e, reason }).onConflictDoNothing().run();
  skipPendingFor(e, `Gesperrt (${reason})`);
}

export function removeSuppression(email: string): void {
  getDb().delete(schema.suppressionList).where(eq(schema.suppressionList.email, normalizeEmail(email))).run();
}

/**
 * Abmeldung über Slug. Idempotent. Gibt false zurück, wenn der Slug unbekannt ist
 * (Aufrufer antwortet trotzdem neutral, damit nichts durchsickert).
 */
export function unsubscribeBySlug(slug: string): boolean {
  const db = getDb();
  const lead = db.select().from(schema.leads).where(eq(schema.leads.slug, slug)).get();
  if (!lead) return false;
  db.transaction((tx) => {
    const schonAbgemeldet = lead.unsubscribed;
    if (!schonAbgemeldet) {
      tx.update(schema.leads).set({ unsubscribed: true, unsubscribedAt: new Date() }).where(eq(schema.leads.id, lead.id)).run();
      tx.insert(schema.events).values({ leadId: lead.id, type: 'unsubscribe', meta: { quelle: 'abmeldung' }, isBot: false }).run();
    }
    tx.insert(schema.suppressionList).values({ email: normalizeEmail(lead.email), reason: 'abmeldung' }).onConflictDoNothing().run();
    tx.update(schema.leads)
      .set({ sendStatus: 'uebersprungen', sendError: 'Abgemeldet' })
      .where(and(eq(schema.leads.email, normalizeEmail(lead.email)), inArray(schema.leads.sendStatus, ['nicht_gesendet', 'geplant'])))
      .run();
  });
  return true;
}
