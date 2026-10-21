import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { isBotUserAgent } from './bots';
import { hashIp } from './crypto';
import { getDb, schema } from './db';
import { clientIp } from './request';
import { berechneScore } from './score';
import { heissSchwelle } from './settings';
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
  meldeHeissenLead(leadId, score);
  return score;
}

/**
 * Erreicht der Score die Heiß-Schwelle, wird das einmal je Lead festgehalten (`heissAt`) und der Webhook `heisser_lead`
 * ausgelöst, damit jemand sofort anruft. Abgemeldete und bereits beendete Leads (Antwort, Bounce) melden nichts.
 */
function meldeHeissenLead(leadId: number, score: number): void {
  try {
    if (score < heissSchwelle()) return;
    const db = getDb();
    const lead = db.select({ heissAt: schema.leads.heissAt, unsubscribed: schema.leads.unsubscribed, flowStopp: schema.leads.flowStopp, firma: schema.leads.firma }).from(schema.leads).where(eq(schema.leads.id, leadId)).get();
    if (!lead || lead.heissAt || lead.unsubscribed || lead.flowStopp === 'bounce') return;
    const jetzt = new Date();
    db.update(schema.leads).set({ heissAt: jetzt }).where(eq(schema.leads.id, leadId)).run();
    webhookAusloesen('heisser_lead', { leadId, score, firma: lead.firma }, jetzt);
  } catch (e) {
    console.error('[webhook] Heißer Lead:', e instanceof Error ? e.message : e);
  }
}

/** Speichert ein Event und berechnet den Score neu. */
export function recordEvent(args: {
  leadId: number;
  type: EventTyp;
  meta?: Record<string, unknown> | null;
  ipHash: string | null;
  userAgent: string | null;
  isBot: boolean;
  /** Zeitpunkt des Events (Standard: jetzt, sekundengenau durch die DB); für Millisekunden-Genauigkeit angeben */
  createdAt?: Date;
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
      ...(args.createdAt ? { createdAt: args.createdAt } : {}),
    })
    .run();
  aktualisiereScore(args.leadId);
  if (!args.isBot) loeseWebhookAus(args.leadId, args.type, args.meta ?? null);
}

/**
 * Webhooks zu einem Tracking-Event (nie für Bots). `video_angesehen`, `video_gestartet` und `video_klick` gibt es je Lead nur beim
 * ersten Mal; Termin- und Link-Klicks bei jedem (nicht-Bot-)Klick.
 */
function loeseWebhookAus(leadId: number, type: EventTyp, meta: Record<string, unknown> | null): void {
  try {
    if (type === 'cta_click') webhookAusloesen('termin_klick', { leadId });
    else if (type === 'link_click') webhookAusloesen('link_klick', { leadId, url: typeof meta?.url === 'string' ? meta.url : null });
    else if (type === 'page_view' || type === 'play' || type === 'video_link_click') {
      const n = getDb()
        .select({ n: sql<number>`count(*)` })
        .from(schema.events)
        .where(and(eq(schema.events.leadId, leadId), eq(schema.events.type, type), eq(schema.events.isBot, false)))
        .get()?.n;
      if (n === 1) webhookAusloesen(type === 'page_view' ? 'video_angesehen' : type === 'play' ? 'video_gestartet' : 'video_klick', { leadId });
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
  /** Klicks auf den Video-Link in der Mail (Nicht-Bot) */
  mailKlicks: number;
  /** Unix-ms des ersten bzw. letzten Nicht-Bot-Events der Art oder null */
  mailKlickErster: number | null;
  playErster: number | null;
  terminErster: number | null;
  terminLetzter: number | null;
};

/** „Video geklickt“: erster Mail-Klick oder erster Videostart, was früher war (null = beides nie). */
export function videoGeklicktZeit(m: Pick<LeadMetriken, 'mailKlickErster' | 'playErster'> | undefined | null): number | null {
  const z = [m?.mailKlickErster ?? null, m?.playErster ?? null].filter((x): x is number => x !== null);
  return z.length ? Math.min(...z) : null;
}

export const LEERE_METRIKEN: LeadMetriken = { aufrufe: 0, videostarts: 0, maxProgress: 0, terminKlicks: 0, oeffnungen: 0, mailKlicks: 0, mailKlickErster: null, playErster: null, terminErster: null, terminLetzter: null };

/** Kennzahlen je Lead einer Kampagne (nur Nicht-Bot-Events), per SQL-Aggregat. */
export function ladeLeadMetriken(campaignId: number): Map<number, LeadMetriken> {
  const typ = schema.events.type;
  const zeit = schema.events.createdAt;
  const rows = getDb()
    .select({
      leadId: schema.events.leadId,
      aufrufe: sql<number>`sum(case when ${typ} = 'page_view' then 1 else 0 end)`,
      videostarts: sql<number>`sum(case when ${typ} = 'play' then 1 else 0 end)`,
      maxProgress: sql<number>`max(case ${typ} when 'progress_100' then 100 when 'progress_75' then 75 when 'progress_50' then 50 when 'progress_25' then 25 else 0 end)`,
      terminKlicks: sql<number>`sum(case when ${typ} = 'cta_click' then 1 else 0 end)`,
      oeffnungen: sql<number>`sum(case when ${typ} = 'email_open' then 1 else 0 end)`,
      mailKlicks: sql<number>`sum(case when ${typ} = 'video_link_click' then 1 else 0 end)`,
      mailKlickErster: sql<number | null>`min(case when ${typ} = 'video_link_click' then ${zeit} end)`,
      playErster: sql<number | null>`min(case when ${typ} = 'play' then ${zeit} end)`,
      terminErster: sql<number | null>`min(case when ${typ} = 'cta_click' then ${zeit} end)`,
      terminLetzter: sql<number | null>`max(case when ${typ} = 'cta_click' then ${zeit} end)`,
    })
    .from(schema.events)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.events.leadId))
    .where(and(eq(schema.leads.campaignId, campaignId), eq(schema.events.isBot, false)))
    .groupBy(schema.events.leadId)
    .all();
  return new Map(
    rows.map((r) => [
      r.leadId,
      {
        aufrufe: r.aufrufe ?? 0,
        videostarts: r.videostarts ?? 0,
        maxProgress: r.maxProgress ?? 0,
        terminKlicks: r.terminKlicks ?? 0,
        oeffnungen: r.oeffnungen ?? 0,
        mailKlicks: r.mailKlicks ?? 0,
        mailKlickErster: r.mailKlickErster ?? null,
        playErster: r.playErster ?? null,
        terminErster: r.terminErster ?? null,
        terminLetzter: r.terminLetzter ?? null,
      },
    ]),
  );
}

export type Aktivitaet = { eventId: number; leadId: number; campaignId: number; kampagne: string; firma: string; ansprechpartner: string; type: 'video_link_click' | 'play' | 'cta_click'; zeit: number };

/** Letzte Nicht-Bot-Aktivitäten (Mail-Klick, Videostart, Termin-Klick) über alle Kampagnen, neueste zuerst. */
export function ladeLetzteAktivitaeten(limit = 20): Aktivitaet[] {
  return getDb()
    .select({
      eventId: schema.events.id,
      leadId: schema.leads.id,
      campaignId: schema.leads.campaignId,
      kampagne: schema.campaigns.name,
      firma: schema.leads.firma,
      vorname: schema.leads.vorname,
      nachname: schema.leads.nachname,
      type: schema.events.type,
      zeit: schema.events.createdAt,
    })
    .from(schema.events)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.events.leadId))
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .where(and(eq(schema.events.isBot, false), inArray(schema.events.type, ['video_link_click', 'play', 'cta_click'])))
    .orderBy(desc(schema.events.createdAt), desc(schema.events.id))
    .limit(limit)
    .all()
    .map((r) => ({
      eventId: r.eventId,
      leadId: r.leadId,
      campaignId: r.campaignId,
      kampagne: r.kampagne,
      firma: r.firma,
      ansprechpartner: [r.vorname, r.nachname].filter(Boolean).join(' '),
      type: r.type as Aktivitaet['type'],
      zeit: r.zeit.getTime(),
    }));
}
