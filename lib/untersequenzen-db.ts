import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { istAusloeserStatus, pruefeUebernahme, type UebernahmeAusschluss } from './untersequenz';
import { createSlug } from './slug';
import { isSuppressed } from './suppression';
import type { LeadStatus } from './lead-status';

// Datenbankzugriffe für Untersequenz-Regeln und die Übernahme von Leads in eine Ziel-Kampagne

export type RegelAnsicht = {
  id: number;
  campaignId: number;
  ausloeserStatus: LeadStatus;
  zielCampaignId: number;
  zielName: string;
  aktiv: boolean;
};

/** Regeln einer Quell-Kampagne samt Name der Ziel-Kampagne */
export function ladeRegeln(campaignId: number): RegelAnsicht[] {
  return getDb()
    .select({
      id: schema.untersequenzen.id,
      campaignId: schema.untersequenzen.campaignId,
      ausloeserStatus: schema.untersequenzen.ausloeserStatus,
      zielCampaignId: schema.untersequenzen.zielCampaignId,
      zielName: schema.campaigns.name,
      aktiv: schema.untersequenzen.aktiv,
    })
    .from(schema.untersequenzen)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.untersequenzen.zielCampaignId))
    .where(eq(schema.untersequenzen.campaignId, campaignId))
    .orderBy(asc(schema.untersequenzen.id))
    .all();
}

export type RegelFehler = 'status' | 'quelle' | 'ziel' | 'gleich' | 'doppelt';

/** Legt eine Regel an; Fehlercode statt Regel, wenn sie nicht zulässig ist. */
export function legeRegelAn(campaignId: number, ausloeserStatus: string, zielCampaignId: number): { ok: true; id: number } | { ok: false; fehler: RegelFehler } {
  const db = getDb();
  if (!istAusloeserStatus(ausloeserStatus)) return { ok: false, fehler: 'status' };
  if (campaignId === zielCampaignId) return { ok: false, fehler: 'gleich' };
  const kampagne = (id: number) => db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!kampagne(campaignId)) return { ok: false, fehler: 'quelle' };
  if (!kampagne(zielCampaignId)) return { ok: false, fehler: 'ziel' };
  const vorhanden = db
    .select({ id: schema.untersequenzen.id })
    .from(schema.untersequenzen)
    .where(and(eq(schema.untersequenzen.campaignId, campaignId), eq(schema.untersequenzen.ausloeserStatus, ausloeserStatus), eq(schema.untersequenzen.zielCampaignId, zielCampaignId)))
    .get();
  if (vorhanden) return { ok: false, fehler: 'doppelt' };
  const r = db.insert(schema.untersequenzen).values({ campaignId, ausloeserStatus, zielCampaignId }).returning({ id: schema.untersequenzen.id }).get();
  return { ok: true, id: r.id };
}

export function setzeRegelAktiv(campaignId: number, regelId: number, aktiv: boolean): boolean {
  return (
    getDb()
      .update(schema.untersequenzen)
      .set({ aktiv })
      .where(and(eq(schema.untersequenzen.id, regelId), eq(schema.untersequenzen.campaignId, campaignId)))
      .run().changes > 0
  );
}

export function loescheRegel(campaignId: number, regelId: number): boolean {
  return getDb().delete(schema.untersequenzen).where(and(eq(schema.untersequenzen.id, regelId), eq(schema.untersequenzen.campaignId, campaignId))).run().changes > 0;
}

export type UebernahmeErgebnis = { regelId: number; zielCampaignId: number } & ({ uebernommen: true; neuerLeadId: number } | { uebernommen: false; grund: UebernahmeAusschluss });

/**
 * Wendet alle aktiven Regeln der Kampagne des Leads für den neuen Status an: Der Lead wird je Regel in die Ziel-Kampagne
 * kopiert (Stammdaten, extra, Zeitzone, Postfach; neuer Slug, Flow startet neu). Ein Event „untersequenz“ im
 * Ursprungs-Lead hält es für die Zeitleiste fest. Nicht übernommen wird bei Ausschlussgründen (siehe pruefeUebernahme).
 * Wird zentral von setzeLeadStatus aufgerufen – egal ob manuell, Pipeline oder KI.
 */
export function wendeUntersequenzenAn(leadId: number, status: LeadStatus, jetzt: Date = new Date()): UebernahmeErgebnis[] {
  const db = getDb();
  return db.transaction((tx) => {
    const lead = tx.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
    if (!lead) return [];
    const regeln = tx
      .select()
      .from(schema.untersequenzen)
      .where(and(eq(schema.untersequenzen.campaignId, lead.campaignId), eq(schema.untersequenzen.ausloeserStatus, status), eq(schema.untersequenzen.aktiv, true)))
      .orderBy(asc(schema.untersequenzen.id))
      .all();
    const ergebnisse: UebernahmeErgebnis[] = [];
    for (const regel of regeln) {
      const ziel = tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, regel.zielCampaignId)).get();
      if (!ziel) continue;
      const schonInZiel = !!tx
        .select({ id: schema.leads.id })
        .from(schema.leads)
        .where(and(eq(schema.leads.campaignId, ziel.id), sql`lower(${schema.leads.email}) = ${lead.email.trim().toLowerCase()}`))
        .get();
      const grund = pruefeUebernahme({ quelleCampaignId: lead.campaignId, zielCampaignId: ziel.id, abgemeldet: lead.unsubscribed, gesperrt: isSuppressed(lead.email), schonInZiel });
      if (grund) {
        ergebnisse.push({ regelId: regel.id, zielCampaignId: ziel.id, uebernommen: false, grund });
        continue;
      }
      const slug = createSlug(lead.firma, (s) => !!tx.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.slug, s)).get());
      // Video-Kampagne: nur vormerken, wenn sie bereits rendert/sendet – sonst wartet der Lead wie ein importierter
      const vormerken = ziel.mitVideo && (ziel.status === 'rendert' || ziel.status === 'versendet_laufend');
      const neu = tx
        .insert(schema.leads)
        .values({
          campaignId: ziel.id,
          firma: lead.firma,
          anrede: lead.anrede,
          vorname: lead.vorname,
          nachname: lead.nachname,
          email: lead.email,
          position: lead.position,
          website: lead.website,
          zeitzone: lead.zeitzone,
          extra: lead.extra,
          slug,
          absenderId: lead.absenderId,
          herkunftLeadId: lead.id,
          renderRequested: vormerken,
        })
        .returning({ id: schema.leads.id })
        .get();
      tx.insert(schema.events).values({ leadId: lead.id, type: 'untersequenz', meta: { regelId: regel.id, zielCampaignId: ziel.id, zielLeadId: neu.id, status }, createdAt: jetzt }).run();
      ergebnisse.push({ regelId: regel.id, zielCampaignId: ziel.id, uebernommen: true, neuerLeadId: neu.id });
    }
    return ergebnisse;
  });
}
