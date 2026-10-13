import { and, desc, eq, gt, max } from 'drizzle-orm';
import { isBotUserAgent } from './bots';
import { getDb, schema } from './db';
import { recordEvent } from './tracking';

// Klick auf den Video-Link in der Mail (Route /r/<slug>, Event `video_link_click`).
//
// Bot-Erkennung zusätzlich zum User-Agent (lib/bots.ts), weil Mail-Scanner (Safe Links, Proofpoint, Virenscanner
// beim Empfangsserver) Links oft mit einem normalen Browser-UA vorab abrufen:
//  - Klick höchstens BOT_FENSTER_NACH_VERSAND_MS (60 s) nach dem Versand der Mail  -> grund "kurz-nach-versand"
//  - weiterer Klick desselben Leads innerhalb BOT_SERIE_MS (2 s) nach einem anderen -> grund "serie"; der vorherige
//    Klick der Serie wird ebenfalls als Bot markiert (Scanner rufen Bild- und Textlink gemeinsam ab)
// Ein Bot-Klick wird gespeichert (isBot = true, meta.grund), zählt aber weder für Score noch Zeiten noch Webhooks.
// Ein Mensch, der innerhalb von 60 s nach dem Versand klickt, wird dadurch fälschlich als Bot gewertet; sein
// Videostart bzw. Termin-Klick zählt trotzdem (die kommen über /api/t).

export const BOT_FENSTER_NACH_VERSAND_MS = 60_000;
export const BOT_SERIE_MS = 2_000;

export type VideoKlickGrund = 'user-agent' | 'kurz-nach-versand' | 'serie';

/** Speichert einen Mail-Klick und gibt zurück, ob (und warum) er als Bot gewertet wurde. */
export function erfasseVideoKlick(args: { leadId: number; userAgent: string | null; ipHash: string | null; jetzt?: Date }): { isBot: boolean; grund: VideoKlickGrund | null } {
  const db = getDb();
  const jetzt = args.jetzt ?? new Date();
  let grund: VideoKlickGrund | null = isBotUserAgent(args.userAgent) ? 'user-agent' : null;

  if (!grund) {
    const versand = db.select({ t: max(schema.sentMessages.sentAt) }).from(schema.sentMessages).where(eq(schema.sentMessages.leadId, args.leadId)).get()?.t;
    const lead = db.select({ sentAt: schema.leads.sentAt }).from(schema.leads).where(eq(schema.leads.id, args.leadId)).get();
    const zeitpunkte = [versand, lead?.sentAt].filter((t): t is Date => t instanceof Date).map((t) => t.getTime());
    const letzter = zeitpunkte.length ? Math.max(...zeitpunkte) : null;
    if (letzter !== null && jetzt.getTime() - letzter < BOT_FENSTER_NACH_VERSAND_MS && jetzt.getTime() >= letzter) grund = 'kurz-nach-versand';
  }

  if (!grund) {
    const vorher = db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(and(eq(schema.events.leadId, args.leadId), eq(schema.events.type, 'video_link_click'), gt(schema.events.createdAt, new Date(jetzt.getTime() - BOT_SERIE_MS))))
      .orderBy(desc(schema.events.id))
      .all();
    if (vorher.length > 0) {
      grund = 'serie';
      for (const v of vorher) db.update(schema.events).set({ isBot: true }).where(eq(schema.events.id, v.id)).run();
    }
  }

  recordEvent({
    leadId: args.leadId,
    type: 'video_link_click',
    meta: grund ? { grund } : null,
    ipHash: args.ipHash,
    userAgent: args.userAgent,
    isBot: grund !== null,
    createdAt: jetzt,
  });
  return { isBot: grund !== null, grund };
}
