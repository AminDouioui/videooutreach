import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { getEnv } from './env';
import { kannAntwortenPruefen, type GmailSender, type ThreadPruefer } from './gmail';
import { decideSend, randomGapMs } from './send-plan';
import { countSentToday, ladeFollowups, pruefeAntwort, readSendState, sendFollowup, sendLead, writeSendState, type SendResult } from './send';
import { globalDailyLimit } from './settings';
import { skipPendingFor } from './suppression';
import { todayBerlin } from './time';

// Ein Durchlauf der Versandschleife (ohne Timer, damit testbar)

export type TickDeps = {
  sender?: GmailSender;
  pruefer?: ThreadPruefer;
  now?: Date;
  zufall?: () => number;
  log?: (msg: string) => void;
};

export type TickResult = { sent: number; completed: number[]; waiting: string[]; error?: string };

const TAG_MS = 24 * 60 * 60 * 1000;
// Antworten auch nach dem letzten Follow-up noch so lange erkennen (für die Anzeige)
const ANTWORT_NACHLAUF_MS = 14 * TAG_MS;
// Wie oft ein Thread höchstens geprüft wird (Hintergrund-Prüfung, nicht vor einem Follow-up)
const PRUEF_INTERVALL_MS = 60 * 60 * 1000;

/** Verbleibende Erstmail-Kandidaten: geplant, oder nicht gesendet + versandbereit (gerendert bzw. Text-Kampagne). */
function offeneErstmails(campaign: typeof schema.campaigns.$inferSelect) {
  const bereit = campaign.mitVideo ? eq(schema.leads.renderStatus, 'fertig') : sql`1 = 1`;
  return getDb()
    .select()
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.campaignId, campaign.id),
        or(eq(schema.leads.sendStatus, 'geplant'), and(eq(schema.leads.sendStatus, 'nicht_gesendet'), bereit)),
      ),
    )
    .orderBy(asc(schema.leads.id))
    .all();
}

/** Leads mit noch ausstehenden Follow-ups (Flow läuft) samt Zeitpunkt der letzten Mail. */
function laufendeFlows(campaignId: number, anzahlFollowups: number) {
  if (anzahlFollowups === 0) return [];
  return getDb()
    .select({
      lead: schema.leads,
      letzteMail: sql<number>`(select max(${schema.sentMessages.sentAt}) from ${schema.sentMessages} where ${schema.sentMessages.leadId} = ${schema.leads.id})`,
    })
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.campaignId, campaignId),
        eq(schema.leads.sendStatus, 'gesendet'),
        isNull(schema.leads.flowStopp),
        isNull(schema.leads.sendError),
        eq(schema.leads.unsubscribed, false),
        lt(schema.leads.followupsSent, anzahlFollowups),
      ),
    )
    .all();
}

/** Hintergrund-Prüfung auf Antworten (für die Anzeige): höchstens ein Thread pro Durchlauf. */
async function pruefeEinenThread(jetzt: Date, deps: TickDeps): Promise<void> {
  if (!deps.pruefer && !kannAntwortenPruefen()) return;
  const db = getDb();
  const lead = db
    .select()
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.sendStatus, 'gesendet'),
        isNull(schema.leads.flowStopp),
        sql`${schema.leads.gmailThreadId} is not null`,
        sql`${schema.leads.sentAt} > ${jetzt.getTime() - ANTWORT_NACHLAUF_MS - 30 * TAG_MS}`,
        or(isNull(schema.leads.replyCheckedAt), lt(schema.leads.replyCheckedAt, new Date(jetzt.getTime() - PRUEF_INTERVALL_MS))),
      ),
    )
    .orderBy(sql`coalesce(${schema.leads.replyCheckedAt}, 0)`)
    .limit(1)
    .get();
  if (!lead) return;
  try {
    await pruefeAntwort(lead, deps.pruefer, jetzt);
  } catch {
    // Prüfung ist nur Komfort für die Anzeige; vor jedem Follow-up wird ohnehin geprüft
    db.update(schema.leads).set({ replyCheckedAt: jetzt }).where(eq(schema.leads.id, lead.id)).run();
  }
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

    const followups = ladeFollowups(k.id);
    const erstmails = offeneErstmails(k);
    const flows = laufendeFlows(k.id, followups.length);
    if (erstmails.length === 0 && flows.length === 0) {
      db.update(schema.campaigns).set({ status: 'abgeschlossen' }).where(eq(schema.campaigns.id, k.id)).run();
      result.completed.push(k.id);
      log(`Kampagne ${k.id} abgeschlossen`);
      continue;
    }

    // Fällig: Wartezeit des nächsten Schritts seit der letzten Mail abgelaufen
    const faellig = flows
      .filter((f) => f.letzteMail !== null && f.letzteMail + followups[f.lead.followupsSent].waitDays * TAG_MS <= jetzt.getTime())
      .sort((a, b) => a.letzteMail - b.letzteMail);
    const bereit = k.mitVideo ? erstmails.filter((l) => l.renderStatus === 'fertig') : erstmails;
    if (faellig.length === 0 && bereit.length === 0) {
      result.waiting.push(`${k.id}:${erstmails.length > 0 ? 'nicht_gerendert' : 'followups_spaeter'}`);
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

    // Fällige Follow-ups zuerst (sie halten den Thread warm), danach neue Erstmails
    let res: SendResult | null = null;
    let ziel = '';
    for (const f of faellig) {
      ziel = `Follow-up ${f.lead.followupsSent + 1} an Lead ${f.lead.id}`;
      res = await sendFollowup(f.lead.id, { sender: deps.sender, pruefer: deps.pruefer, now: jetzt });
      // Beendeter Flow (Antwort/Bounce) kostet keinen Versand-Slot: nächsten Kandidaten nehmen
      if (!res.ok && (res.kind === 'flow_beendet' || res.kind === 'uebersprungen')) {
        log(`${ziel}: ${res.error}`);
        res = null;
        continue;
      }
      break;
    }
    if (res?.ok === false && res.kind === 'antwort_pruefung_fehlt') {
      result.waiting.push(`${k.id}:antwort_pruefung_fehlt`);
      res = null;
    }
    if (!res && bereit.length > 0) {
      ziel = `Mail an Lead ${bereit[0].id}`;
      res = await sendLead(bereit[0].id, { sender: deps.sender, now: jetzt });
    }
    if (!res) continue;

    if (res.ok) {
      result.sent++;
      writeSendState({ nextSendAt: jetzt.getTime() + randomGapMs(env.SEND_MIN_GAP_MINUTES, env.SEND_MAX_GAP_MINUTES, deps.zufall) }, jetzt);
      log(`${ziel} gesendet`);
    } else if (res.kind === 'quota') {
      log(`Quota erreicht – Versand heute gestoppt: ${res.error}`);
      result.waiting.push(`${k.id}:quota_gestoppt`);
    } else if (res.kind === 'auth' || res.kind === 'nicht_verbunden') {
      // Kurze Pause, damit die Schleife nicht im Sekundentakt gegen die Wand läuft
      writeSendState({ nextSendAt: jetzt.getTime() + 5 * 60_000 }, jetzt);
      result.error = res.error;
      log(`Versand nicht möglich: ${res.error}`);
    } else {
      log(`${ziel}: ${res.kind} – ${res.error}`);
    }
  }

  if (result.sent === 0) await pruefeEinenThread(jetzt, deps);
  return result;
}
