import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { getDb, schema } from './db';
import { getEnv } from './env';
import type { GmailSender } from './gmail';
import { decideSend, randomGapMs } from './send-plan';
import { countSentToday, readSendState, sendLead, writeSendState } from './send';
import { globalDailyLimit } from './settings';
import { skipPendingFor } from './suppression';
import { todayBerlin } from './time';

// Ein Durchlauf der Versandschleife (ohne Timer, damit testbar)

export type TickDeps = {
  sender?: GmailSender;
  now?: Date;
  zufall?: () => number;
  log?: (msg: string) => void;
};

export type TickResult = { sent: number; completed: number[]; waiting: string[]; error?: string };

/** Verbleibende Kandidaten einer Kampagne: geplant, oder nicht gesendet + fertig gerendert. */
function offeneLeads(campaignId: number) {
  return getDb()
    .select()
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.campaignId, campaignId),
        or(eq(schema.leads.sendStatus, 'geplant'), and(eq(schema.leads.sendStatus, 'nicht_gesendet'), eq(schema.leads.renderStatus, 'fertig'))),
      ),
    )
    .orderBy(asc(schema.leads.id))
    .all();
}

/** Sendet höchstens eine Mail (der Abstand gilt kampagnenübergreifend) und aktualisiert Kampagnen-Status. */
export async function runSendTick(deps: TickDeps = {}): Promise<TickResult> {
  const db = getDb();
  const env = getEnv();
  const jetzt = deps.now ?? new Date();
  const log = deps.log ?? (() => {});
  const result: TickResult = { sent: 0, completed: [], waiting: [] };

  const kampagnen = db.select().from(schema.campaigns).where(eq(schema.campaigns.status, 'versendet_laufend')).orderBy(asc(schema.campaigns.id)).all();

  for (const k of kampagnen) {
    // Gesperrte/abgemeldete Adressen vorab überspringen
    const gesperrt = db.select({ email: schema.suppressionList.email }).from(schema.suppressionList).all();
    for (const g of gesperrt) skipPendingFor(g.email, 'Auf der Sperrliste');
    db.update(schema.leads)
      .set({ sendStatus: 'uebersprungen', sendError: 'Abgemeldet' })
      .where(and(eq(schema.leads.campaignId, k.id), eq(schema.leads.unsubscribed, true), inArray(schema.leads.sendStatus, ['nicht_gesendet', 'geplant'])))
      .run();

    const offen = offeneLeads(k.id);
    if (offen.length === 0) {
      db.update(schema.campaigns).set({ status: 'abgeschlossen' }).where(eq(schema.campaigns.id, k.id)).run();
      result.completed.push(k.id);
      log(`Kampagne ${k.id} abgeschlossen`);
      continue;
    }
    const bereit = offen.filter((l) => l.renderStatus === 'fertig');
    if (bereit.length === 0) {
      result.waiting.push(`${k.id}:nicht_gerendert`);
      continue;
    }
    if (result.sent > 0) continue; // höchstens eine Mail pro Durchlauf

    const state = readSendState(jetzt);
    const plan = decideSend({
      now: jetzt,
      today: todayBerlin(jetzt),
      campaign: k,
      globalLimit: globalDailyLimit(),
      sentTodayGlobal: countSentToday(undefined, jetzt),
      sentTodayCampaign: countSentToday(k.id, jetzt),
      state,
    });
    if (plan.action === 'wait') {
      result.waiting.push(`${k.id}:${plan.reason}`);
      continue;
    }

    const res = await sendLead(bereit[0].id, { sender: deps.sender, now: jetzt });
    if (res.ok) {
      result.sent++;
      writeSendState({ nextSendAt: jetzt.getTime() + randomGapMs(env.SEND_MIN_GAP_MINUTES, env.SEND_MAX_GAP_MINUTES, deps.zufall) }, jetzt);
      log(`Mail an Lead ${bereit[0].id} gesendet`);
    } else if (res.kind === 'quota') {
      log(`Quota erreicht – Versand heute gestoppt: ${res.error}`);
      result.waiting.push(`${k.id}:quota_gestoppt`);
    } else if (res.kind === 'auth' || res.kind === 'nicht_verbunden') {
      // Kurze Pause, damit die Schleife nicht im Sekundentakt gegen die Wand läuft
      writeSendState({ nextSendAt: jetzt.getTime() + 5 * 60_000 }, jetzt);
      result.error = res.error;
      log(`Versand nicht möglich: ${res.error}`);
    } else {
      log(`Lead ${bereit[0].id}: ${res.kind} – ${res.error}`);
    }
  }
  return result;
}
