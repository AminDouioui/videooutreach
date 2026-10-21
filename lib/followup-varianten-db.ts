import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { alleThreadIds, kuerzelOderA, type FollowupText } from './followup-varianten';
import { passendeVarianten, verhaltensstufe, wenigsteVersendungen, type Verhaltensstufe } from './verhalten';
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

/** Verhaltensstufe des Leads aus seinen Nicht-Bot-Events (Video gesehen, gestartet, Termin-Klick …) */
export function ladeVerhaltensstufe(leadId: number): Verhaltensstufe {
  const events = getDb().select({ type: schema.events.type, isBot: schema.events.isBot }).from(schema.events).where(eq(schema.events.leadId, leadId)).all();
  return verhaltensstufe(events);
}

/**
 * Variante für das nächste Follow-up dieses Schritts. Passt eine aktive Variante genau zum Verhalten des Leads
 * (`stufe`, z. B. „Video komplett gesehen“), wird unter diesen rotiert. Sonst rotiert die Auswahl unter A und den
 * aktiven Varianten ohne Verhaltensbezug („immer“).
 */
export function waehleFollowupVariante(schritt: Followup, step: number, stufe?: Verhaltensstufe): FollowupText {
  const zusatz = ladeFollowupVarianten(schritt.id);
  const aktive = zusatz.filter((v) => v.aktiv);
  const zaehler = followupVariantenZaehler(schritt.campaignId, step);
  const spezifisch = stufe ? passendeVarianten(aktive, stufe) : null;
  const allgemein = aktive.filter((v) => !v.verhalten || v.verhalten === 'immer');
  const kuerzel = spezifisch
    ? wenigsteVersendungen(spezifisch.map((v) => v.kuerzel), zaehler)
    : allgemein.length === 0
      ? STANDARD_VARIANTE
      : waehleVariante(allgemein.map((v) => v.kuerzel), zaehler);
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
