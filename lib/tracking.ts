import { and, eq, gt, sql } from 'drizzle-orm';
import { isBotUserAgent } from './bots';
import { hashIp } from './crypto';
import { getDb, schema } from './db';
import { clientIp } from './request';
import { berechneScore } from './score';
import { webhookAusloesen } from './webhooks';

export type EventTyp = (typeof schema.EVENT_TYPEN)[number];

/** Gehashte Client-IP (nur sha256 mit Salt wird gespeichert). */
export function getClientIpHash(req: Request): string {
  return hashIp(clientIp(req));
}

/** Berechnet den Score eines Leads neu und speichert ihn. */
export function aktualisiereScore(leadId: number): number {
  const db = getDb();
  const rows = db
    .select({ type: schema.events.type, isBot: schema.events.isBot, createdAt: schema.events.createdAt })
    .from(schema.events)
    .where(eq(schema.events.leadId, leadId))
    .all();
  const score = berechneScore(rows);
  db.update(schema.leads).set({ score }).where(eq(schema.leads.id, leadId)).run();
  return score;
}

/** Speichert ein Event und berechnet den Score neu. */
export function recordEvent(args: {
  leadId: number;
  type: EventTyp;
  meta?: Record<string, unknown> | null;
  ipHash: string | null;
  userAgent: string | null;
  isBot: boolean;
}): void {
  const db = getDb();
  db.insert(schema.events)
    .values({
      leadId: args.leadId,
      type: args.type,
      meta: args.meta ?? null,
      ipHash: args.ipHash,
      userAgent: args.userAgent ? args.userAgent.slice(0, 400) : null,
      isBot: args.isBot,
    })
    .run();
  aktualisiereScore(args.leadId);
  if (!args.isBot) loeseWebhookAus(args.leadId, args.type, args.meta ?? null);
}

/**
 * Webhooks zu einem Tracking-Event (nie für Bots). `video_angesehen` und `video_gestartet` gibt es je Lead nur beim
 * ersten Mal; Termin- und Link-Klicks bei jedem (nicht-Bot-)Klick.
 */
function loeseWebhookAus(leadId: number, type: EventTyp, meta: Record<string, unknown> | null): void {
  try {
    if (type === 'cta_click') webhookAusloesen('termin_klick', { leadId });
    else if (type === 'link_click') webhookAusloesen('link_klick', { leadId, url: typeof meta?.url === 'string' ? meta.url : null });
    else if (type === 'page_view' || type === 'play') {
      const n = getDb()
        .select({ n: sql<number>`count(*)` })
        .from(schema.events)
        .where(and(eq(schema.events.leadId, leadId), eq(schema.events.type, type), eq(schema.events.isBot, false)))
        .get()?.n;
      if (n === 1) webhookAusloesen(type === 'page_view' ? 'video_angesehen' : 'video_gestartet', { leadId });
    }
  } catch (e) {
    console.error('[webhook] Tracking-Ereignis:', e instanceof Error ? e.message : e);
  }
}

/** true, wenn für diesen Lead und Typ in den letzten `ms` Millisekunden schon ein Event existiert. */
export function kuerzlichVorhanden(leadId: number, type: EventTyp, ms: number): boolean {
  const row = getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.events)
    .where(and(eq(schema.events.leadId, leadId), eq(schema.events.type, type), gt(schema.events.createdAt, new Date(Date.now() - ms))))
    .get();
  return (row?.n ?? 0) > 0;
}

export { isBotUserAgent };

export type LeadMetriken = {
  aufrufe: number;
  videostarts: number;
  /** höchster erreichter Fortschritt in % (0/25/50/75/100) */
  maxProgress: number;
  terminKlicks: number;
  oeffnungen: number;
};

/** Kennzahlen je Lead einer Kampagne (nur Nicht-Bot-Events), per SQL-Aggregat. */
export function ladeLeadMetriken(campaignId: number): Map<number, LeadMetriken> {
  const rows = getDb()
    .select({
      leadId: schema.events.leadId,
      aufrufe: sql<number>`sum(case when ${schema.events.type} = 'page_view' then 1 else 0 end)`,
      videostarts: sql<number>`sum(case when ${schema.events.type} = 'play' then 1 else 0 end)`,
      maxProgress: sql<number>`max(case ${schema.events.type} when 'progress_100' then 100 when 'progress_75' then 75 when 'progress_50' then 50 when 'progress_25' then 25 else 0 end)`,
      terminKlicks: sql<number>`sum(case when ${schema.events.type} = 'cta_click' then 1 else 0 end)`,
      oeffnungen: sql<number>`sum(case when ${schema.events.type} = 'email_open' then 1 else 0 end)`,
    })
    .from(schema.events)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.events.leadId))
    .where(and(eq(schema.leads.campaignId, campaignId), eq(schema.events.isBot, false)))
    .groupBy(schema.events.leadId)
    .all();
  return new Map(rows.map((r) => [r.leadId, { aufrufe: r.aufrufe ?? 0, videostarts: r.videostarts ?? 0, maxProgress: r.maxProgress ?? 0, terminKlicks: r.terminKlicks ?? 0, oeffnungen: r.oeffnungen ?? 0 }]));
}
