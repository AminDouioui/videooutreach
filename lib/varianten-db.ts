import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { kampagnenExtraSpalten } from './campaigns';
import { getDb, schema } from './db';
import { STANDARD_VARIANTE, waehleVariante } from './varianten';
import { pruefeVorlage, STANDARD_VARIABLEN } from './vorlage';

// DB-Zugriffe der A/B-Test-Varianten

type Kampagne = typeof schema.campaigns.$inferSelect;

export function ladeVarianten(campaignId: number) {
  return getDb().select().from(schema.varianten).where(eq(schema.varianten.campaignId, campaignId)).orderBy(asc(schema.varianten.kuerzel)).all();
}

/** Wie oft die Leads einer Kampagne je Variante angeschrieben wurden (Erstmail gesendet; alte Leads ohne Kürzel = A). */
export function variantenZaehler(campaignId: number): Record<string, number> {
  const rows = getDb()
    .select({ k: sql<string>`coalesce(${schema.leads.variante}, 'A')`, n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(eq(schema.leads.campaignId, campaignId), eq(schema.leads.sendStatus, 'gesendet')))
    .groupBy(sql`coalesce(${schema.leads.variante}, 'A')`)
    .all();
  return Object.fromEntries(rows.map((r) => [r.k, r.n]));
}

/** Variante, die die nächste Erstmail der Kampagne bekäme (rotierend unter den aktiven). */
export function waehleVarianteFuerKampagne(campaignId: number): string {
  const aktive = ladeVarianten(campaignId).filter((v) => v.aktiv).map((v) => v.kuerzel);
  if (aktive.length === 0) return STANDARD_VARIANTE;
  return waehleVariante(aktive, variantenZaehler(campaignId));
}

/**
 * Kampagne mit Betreff/Text der Variante. „A“, leer oder ein unbekanntes Kürzel liefert die Kampagne unverändert
 * (Vorlage = Variante A).
 */
export function kampagneMitVariante(kampagne: Kampagne, kuerzel: string | null | undefined): Kampagne {
  if (!kuerzel || kuerzel === STANDARD_VARIANTE) return kampagne;
  const v = ladeVarianten(kampagne.id).find((x) => x.kuerzel === kuerzel);
  return v ? { ...kampagne, emailSubjectTemplate: v.betreff, emailBodyTemplate: v.text } : kampagne;
}

/** Variante für die Vorschau: gewünschte, sonst die des Leads, sonst die, die er beim Versand bekäme. */
export function vorschauVariante(lead: { variante: string | null; campaignId: number }, gewuenscht?: string | null): string {
  return gewuenscht || lead.variante || waehleVarianteFuerKampagne(lead.campaignId);
}

export const varianteSchema = z.object({
  betreff: z.string().trim().min(1, 'Betreff fehlt').max(300),
  text: z.string().trim().min(1, 'Text fehlt').max(20000),
  aktiv: z.boolean().optional(),
});

/** Prüft Betreff/Text wie die Kampagnen-Vorlage: Klammern blockieren, unbekannte Platzhalter sind nur Warnungen. */
export function pruefeVariante(campaignId: number, betreff: string, text: string): { fehler: string | null; warnungen: string[] } {
  const bekannt = [...STANDARD_VARIABLEN, ...kampagnenExtraSpalten(campaignId)];
  const b = pruefeVorlage(betreff, bekannt);
  const t = pruefeVorlage(text, bekannt);
  const klammern = [...b.fehler.map((f) => `Betreff: ${f}`), ...t.fehler.map((f) => `Text: ${f}`)];
  const unbekannt = [...new Set([...b.unbekannt, ...t.unbekannt])];
  return { fehler: klammern.length ? `Vorlage ungültig: ${klammern.join('; ')}` : null, warnungen: unbekannt.map((u) => `Unbekannter Platzhalter {{${u}}}`) };
}
