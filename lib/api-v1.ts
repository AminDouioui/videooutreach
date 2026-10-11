import { and, count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from './db';
import { getEnv } from './env';
import { STATUS_LABELS, summarize, type RowStatus } from './import';
import { validiereImport } from './import-server';
import { legeLeadsAn } from './lead-anlegen';
import { LEAD_STATUS } from './lead-status';
import type { DnsResolver } from './mx';

// Gemeinsame Bausteine der REST-API /api/v1 (Darstellung der Daten, Leads anlegen). Keine Token/Secrets in Antworten.

export const SEITENGROESSE = 50;
export const MAX_LEADS_PRO_ANFRAGE = 500;

export function kampagneDto(k: typeof schema.campaigns.$inferSelect, leadAnzahl: number) {
  return {
    id: k.id,
    name: k.name,
    status: k.status,
    mitVideo: k.mitVideo,
    zeitzone: k.zeitzone,
    tageslimit: k.dailySendLimit,
    leadAnzahl,
    erstelltAm: k.createdAt.toISOString(),
  };
}

export function leadDto(l: typeof schema.leads.$inferSelect) {
  return {
    id: l.id,
    kampagneId: l.campaignId,
    firma: l.firma,
    anrede: l.anrede,
    vorname: l.vorname,
    nachname: l.nachname,
    email: l.email,
    position: l.position,
    website: l.website,
    zeitzone: l.zeitzone,
    extra: l.extra ?? {},
    leadStatus: l.leadStatus,
    score: l.score,
    sendStatus: l.sendStatus,
    gesendetAm: l.sentAt ? l.sentAt.toISOString() : null,
    followupsGesendet: l.followupsSent,
    flowStopp: l.flowStopp,
    abgemeldet: l.unsubscribed,
    antwortAm: l.antwortAt ? l.antwortAt.toISOString() : null,
    notizen: l.notizen,
    // Deal-Wert in Euro (null = keiner)
    dealWert: l.dealWert == null ? null : l.dealWert / 100,
    videoLink: `${getEnv().APP_URL.replace(/\/$/, '')}/v/${l.slug}`,
    erstelltAm: l.createdAt.toISOString(),
  };
}

export function ladeKampagnen() {
  const db = getDb();
  const zahlen = new Map(db.select({ id: schema.leads.campaignId, n: count() }).from(schema.leads).groupBy(schema.leads.campaignId).all().map((r) => [r.id, r.n]));
  return db.select().from(schema.campaigns).orderBy(desc(schema.campaigns.id)).all().map((k) => kampagneDto(k, zahlen.get(k.id) ?? 0));
}

export function ladeKampagne(id: number) {
  const db = getDb();
  const k = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!k) return null;
  const n = db.select({ n: count() }).from(schema.leads).where(eq(schema.leads.campaignId, id)).get()?.n ?? 0;
  const followups = db.select({ n: count() }).from(schema.followups).where(eq(schema.followups.campaignId, id)).get()?.n ?? 0;
  return { ...kampagneDto(k, n), followups };
}

/** Leads einer Kampagne, seitenweise (50 pro Seite, älteste zuerst), optional nach Lead-Status gefiltert. */
export function ladeLeadsSeite(campaignId: number, seite: number, status?: string) {
  const db = getDb();
  const bed = [eq(schema.leads.campaignId, campaignId)];
  if (status) bed.push(eq(schema.leads.leadStatus, status as (typeof LEAD_STATUS)[number]));
  const gesamt = db.select({ n: count() }).from(schema.leads).where(and(...bed)).get()?.n ?? 0;
  const zeilen = db
    .select()
    .from(schema.leads)
    .where(and(...bed))
    .orderBy(schema.leads.id)
    .limit(SEITENGROESSE)
    .offset((seite - 1) * SEITENGROESSE)
    .all();
  return { seite, seitenGroesse: SEITENGROESSE, gesamt, seiten: Math.max(1, Math.ceil(gesamt / SEITENGROESSE)), leads: zeilen.map(leadDto) };
}

// ---------------------------------------------------------------- Leads anlegen

const wert = z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v));

/** Ein Lead: bekannte Felder wie im Import, alle weiteren Felder werden zu Extra-Spalten (Vorlagen-Variablen). */
export const apiLeadSchema = z
  .object({
    firma: wert.optional(),
    email: wert.optional(),
    name: wert.optional(),
    vorname: wert.optional(),
    nachname: wert.optional(),
    anrede: wert.optional(),
    position: wert.optional(),
    website: wert.optional(),
    land: wert.optional(),
    zeitzone: wert.optional(),
  })
  .catchall(wert);

export const apiLeadsBodySchema = z.object({ leads: z.array(apiLeadSchema).min(1).max(MAX_LEADS_PRO_ANFRAGE), einProFirma: z.boolean().optional(), mxTrotzdem: z.boolean().optional() });

export type ApiLeadsErgebnis = {
  angelegt: number;
  uebersprungen: number;
  zusammenfassung: string;
  ergebnisse: { index: number; email: string; ergebnis: 'angelegt' | 'uebersprungen'; id?: number; grund?: string; code?: RowStatus }[];
};

const FELDER = ['name', 'vorname', 'nachname', 'anrede', 'firma', 'email', 'position', 'website', 'land', 'zeitzone'] as const;

/**
 * Legt Leads über dieselbe Prüfung wie der Import an (ungültige E-Mail, Pflichtfelder, Duplikate in Anfrage und
 * Kampagne, Sperrliste inkl. Domains, MX-Prüfung, Zeitzonen-Erkennung). Ungültige Zeilen werden mit Grund übersprungen.
 */
export async function legeLeadsPerApiAn(
  campaignId: number,
  leads: Record<string, string>[],
  opt: { einProFirma?: boolean; mxTrotzdem?: boolean; resolver?: DnsResolver } = {},
): Promise<ApiLeadsErgebnis> {
  const mapping = Object.fromEntries(FELDER.map((f) => [f, f]));
  const validiert = await validiereImport(campaignId, { mapping: mapping as never, rows: leads, einProFirma: opt.einProFirma ?? false, mxTrotzdem: opt.mxTrotzdem ?? false }, opt.resolver);
  const ids = legeLeadsAn(campaignId, validiert);
  const ergebnisse = validiert.map((r) =>
    ids.has(r.index)
      ? { index: r.index, email: r.lead.email, ergebnis: 'angelegt' as const, id: ids.get(r.index)! }
      : { index: r.index, email: r.lead.email, ergebnis: 'uebersprungen' as const, grund: STATUS_LABELS[r.status], code: r.status },
  );
  return { angelegt: ids.size, uebersprungen: validiert.length - ids.size, zusammenfassung: summarize(validiert), ergebnisse };
}

