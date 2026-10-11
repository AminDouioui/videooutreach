import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { alleThreadIds, kuerzelOderA, type FollowupText } from './followup-varianten';
import { STANDARD_VARIANTE, waehleVariante } from './varianten';

// DB-Zugriffe der Follow-up-Varianten

type Followup = typeof schema.followups.$inferSelect;

export function ladeFollowupVarianten(followupId: number) {
  return getDb().select().from(schema.followupVarianten).where(eq(schema.followupVarianten.followupId, followupId)).orderBy(asc(schema.followupVarianten.kuerzel)).all();
}

/** Wie oft der Schritt (1 = Follow-up 1 …) je Variante schon gesendet wurde; Altbestand ohne Kürzel zählt als A. */
export function followupVariantenZaehler(campaignId: number, step: number): Record<string, number> {
  const rows = getDb()
    .select({ k: sql<string>`coalesce(${schema.sentMessages.variante}, 'A')`, n: sql<number>`count(*)` })
    .from(schema.sentMessages)
    .where(and(eq(schema.sentMessages.campaignId, campaignId), eq(schema.sentMessages.step, step)))
    .groupBy(sql`coalesce(${schema.sentMessages.variante}, 'A')`)
    .all();
  return Object.fromEntries(rows.map((r) => [r.k, r.n]));
}

/** Variante für das nächste Follow-up dieses Schritts: rotierend unter den aktiven (A ist immer dabei). */
export function waehleFollowupVariante(schritt: Followup, step: number): FollowupText {
  const zusatz = ladeFollowupVarianten(schritt.id);
  const aktive = zusatz.filter((v) => v.aktiv);
  const kuerzel = aktive.length === 0 ? STANDARD_VARIANTE : waehleVariante(aktive.map((v) => v.kuerzel), followupVariantenZaehler(schritt.campaignId, step));
  const v = zusatz.find((x) => x.kuerzel === kuerzel);
  return v ? { kuerzel, body: v.text, betreff: v.betreff } : { kuerzel: STANDARD_VARIANTE, body: schritt.body, betreff: schritt.betreff };
}

/** Text einer bestimmten Variante des Schritts (unbekannt/leer = A). */
export function followupText(schritt: Followup, kuerzel: string | null | undefined): FollowupText {
  const k = kuerzelOderA(kuerzel);
  const v = k === STANDARD_VARIANTE ? undefined : ladeFollowupVarianten(schritt.id).find((x) => x.kuerzel === k);
  return v ? { kuerzel: k, body: v.text, betreff: v.betreff } : { kuerzel: STANDARD_VARIANTE, body: schritt.body, betreff: schritt.betreff };
}

/** Alle Threads eines Leads (Erstmail zuerst, dann Follow-ups mit neuem Thread) – Grundlage der Antwort-/Bounce-Erkennung. */
export function threadsDesLeads(lead: { id: number; gmailThreadId: string | null }): string[] {
  const rows = getDb().select({ t: schema.sentMessages.gmailThreadId }).from(schema.sentMessages).where(eq(schema.sentMessages.leadId, lead.id)).orderBy(asc(schema.sentMessages.id)).all();
  return alleThreadIds(lead.gmailThreadId, rows.map((r) => r.t));
}
