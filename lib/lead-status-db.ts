import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { FIRMA_HAT_GEANTWORTET, firmenDomain, statusPatch, type LeadStatus } from './lead-status';

// Datenbankzugriffe für Lead-Status, Antworten und Firmen-Stopp

/** Setzt den Lead-Status und passt den Flow an (siehe statusPatch). false = Lead nicht gefunden. */
export function setzeLeadStatus(leadId: number, status: LeadStatus, jetzt: Date = new Date()): boolean {
  const db = getDb();
  return db.transaction((tx) => {
    const lead = tx.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
    if (!lead) return false;
    const patch = statusPatch(lead, status, jetzt);
    tx.update(schema.leads)
      .set({ ...patch, leadStatus: status, leadStatusAt: status === 'offen' ? null : jetzt })
      .where(eq(schema.leads.id, leadId))
      .run();
    return true;
  });
}

/** Antwort als gelesen/ungelesen markieren */
export function setzeAntwortGelesen(leadId: number, gelesen: boolean): boolean {
  return getDb().update(schema.leads).set({ antwortGelesen: gelesen }).where(eq(schema.leads.id, leadId)).run().changes > 0;
}

/** Anzahl ungelesener Antworten (für die Navigation) */
export function zaehleUngeleseneAntworten(): number {
  const row = getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(eq(schema.leads.flowStopp, 'beantwortet'), eq(schema.leads.antwortGelesen, false)))
    .get();
  return row?.n ?? 0;
}

/**
 * Firmen-Stopp: Hat ein Lead geantwortet, werden alle anderen Leads derselben Kampagne mit gleicher E-Mail-Domain
 * gestoppt (Freemail-Domains ausgenommen) – sofern die Kampagne die Option hat.
 * - bereits gesendet, Flow läuft: flowStopp = 'firma_beantwortet'
 * - Erstmail noch offen: übersprungen („Firma hat geantwortet“)
 * Liefert die Anzahl betroffener Leads.
 */
export function stoppeFirma(leadId: number, jetzt: Date = new Date()): number {
  const db = getDb();
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead) return 0;
  const kampagne = db.select({ stopp: schema.campaigns.stoppBeiFirmenAntwort }).from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
  if (!kampagne?.stopp) return 0;
  const domain = firmenDomain(lead.email);
  if (!domain) return 0;

  const kollegen = db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.campaignId, lead.campaignId), ne(schema.leads.id, lead.id), sql`lower(${schema.leads.email}) like ${'%@' + domain.replace(/[\\%_]/g, '\\$&')} escape '\\'`))
    .all()
    .filter((l) => firmenDomain(l.email) === domain);

  const zuStoppen = kollegen.filter((l) => l.sendStatus === 'gesendet' && !l.flowStopp).map((l) => l.id);
  const zuUeberspringen = kollegen.filter((l) => l.sendStatus === 'nicht_gesendet' || l.sendStatus === 'geplant').map((l) => l.id);
  db.transaction((tx) => {
    if (zuStoppen.length) tx.update(schema.leads).set({ flowStopp: 'firma_beantwortet', flowStoppAt: jetzt }).where(inArray(schema.leads.id, zuStoppen)).run();
    if (zuUeberspringen.length) tx.update(schema.leads).set({ sendStatus: 'uebersprungen', sendError: FIRMA_HAT_GEANTWORTET, renderRequested: false }).where(inArray(schema.leads.id, zuUeberspringen)).run();
  });
  return zuStoppen.length + zuUeberspringen.length;
}
