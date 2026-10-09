import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { kannAntwortenPruefen, ladeAbsender, ladePostfachZustaende, markiereAuthFehler, postfachFuerLead, setzeNaechstenVersand } from './absender';
import { getDb, schema } from './db';
import { getEnv } from './env';
import { GmailSendError, type GmailSender, type ThreadPruefer } from './gmail';
import { FLOW_ENDENDE_STATUS } from './lead-status';
import { blockiertDurch, waehlePostfach, type PostfachBlock } from './rotation';
import { decideSend, randomGapMs } from './send-plan';
import { countSentToday, effektivesGlobalLimit, ladeFollowups, pruefeAntwort, sendFollowup, sendLead, type SendResult } from './send';
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
        notInArray(schema.leads.leadStatus, FLOW_ENDENDE_STATUS),
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
      // "leads"."id" ausdrücklich qualifizieren: unqualifiziert (drizzle-Standard bei einer Tabelle) würde SQLite
      // sent_messages.id meinen und die falsche Mail finden
      letzteMail: sql<number>`(select max(${schema.sentMessages.sentAt}) from ${schema.sentMessages} where ${schema.sentMessages.leadId} = ${schema.leads}."id")`,
    })
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.campaignId, campaignId),
        eq(schema.leads.sendStatus, 'gesendet'),
        isNull(schema.leads.flowStopp),
        notInArray(schema.leads.leadStatus, FLOW_ENDENDE_STATUS),
        isNull(schema.leads.sendError),
        eq(schema.leads.unsubscribed, false),
        lt(schema.leads.followupsSent, anzahlFollowups),
      ),
    )
    .all();
}

/**
 * Hintergrund-Prüfung auf Antworten (für die Anzeige): höchstens ein Thread pro Durchlauf, immer über das Postfach
 * der Erstmail. Leads, deren Postfach nicht prüfen kann (getrennt, Fehler, ohne Leseberechtigung), werden übergangen,
 * damit sie die übrigen nicht aufhalten.
 */
async function pruefeEinenThread(jetzt: Date, deps: TickDeps): Promise<void> {
  const postfaecher = ladeAbsender().filter((a) => !a.fehler && (deps.pruefer ? !!a.refreshTokenEnc : kannAntwortenPruefen(a)));
  if (postfaecher.length === 0) return;
  const ids = postfaecher.map((a) => a.id);
  // Altbestand ohne Zuordnung läuft über das älteste aktive Postfach (siehe postfachFuerLead)
  const fallback = postfachFuerLead({ absenderId: null });
  const zuordnung = fallback && ids.includes(fallback.id) ? or(inArray(schema.leads.absenderId, ids), isNull(schema.leads.absenderId)) : inArray(schema.leads.absenderId, ids);
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
        zuordnung,
      ),
    )
    .orderBy(sql`coalesce(${schema.leads.replyCheckedAt}, 0)`)
    .limit(1)
    .get();
  if (!lead) return;
  try {
    await pruefeAntwort(lead, deps.pruefer, jetzt);
  } catch (e) {
    // Prüfung ist nur Komfort für die Anzeige; vor jedem Follow-up wird ohnehin geprüft.
    // Ein Auth-Fehler gehört aber zum Postfach: sichtbar machen und pausieren, bis es neu verbunden ist.
    const postfach = postfachFuerLead(lead);
    if (postfach && e instanceof GmailSendError && e.info.art === 'auth') markiereAuthFehler(postfach.id, e.info.meldung);
    db.update(schema.leads).set({ replyCheckedAt: jetzt }).where(eq(schema.leads.id, lead.id)).run();
  }
}

/** Warte-Grund einer blockierten Follow-up-Zustellung (Name wie bei Erstmails, damit die Anzeige einheitlich bleibt) */
function followupWartGrund(b: PostfachBlock | 'kein_postfach'): string {
  switch (b) {
    case 'fehler':
      return 'postfach_fehler';
    case 'inaktiv':
    case 'nicht_verbunden':
    case 'kein_postfach':
      return 'followup_postfach_nicht_verfuegbar';
    default:
      return b;
  }
}

/**
 * Sendet höchstens eine Mail pro Durchlauf und aktualisiert den Kampagnen-Status.
 *
 * Entscheidung zur Parallelität: weiterhin eine Mail pro Durchlauf (nicht je Postfach). Der Durchlauf läuft alle 3 s,
 * der Abstand je Postfach beträgt Minuten – ein Durchlauf pro Mail reicht also locker für beliebig viele Postfächer,
 * bleibt einfach und lässt nach jedem Versand den Zustand (Zähler, Abstand, Fehler) neu einlesen. Der Abstand
 * (SEND_MIN/MAX_GAP) gilt je Postfach (absender.next_send_at); mehrere Postfächer senden dadurch zeitversetzt parallel.
 */
export async function runSendTick(deps: TickDeps = {}): Promise<TickResult> {
  const db = getDb();
  const env = getEnv();
  const jetzt = deps.now ?? new Date();
  const heute = todayBerlin(jetzt);
  const log = deps.log ?? (() => {});
  const result: TickResult = { sent: 0, completed: [], waiting: [] };

  const kampagnen = db.select().from(schema.campaigns).where(eq(schema.campaigns.status, 'versendet_laufend')).orderBy(asc(schema.campaigns.id)).all();

  // Zustand der Postfächer einmal pro Durchlauf: es geht höchstens eine Mail raus, danach wird nichts mehr gesendet
  let zustaende: ReturnType<typeof ladePostfachZustaende> | null = null;
  const postfaecher = () => (zustaende ??= ladePostfachZustaende(jetzt));

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
    let bereit = k.mitVideo ? erstmails.filter((l) => l.renderStatus === 'fertig') : erstmails;
    // Limit „neue Leads pro Tag“ erreicht: nur noch fällige Follow-ups (sie zählen nicht dazu)
    const neueLeadsErreicht = k.maxNeueLeadsProTag !== null && countSentToday(k.id, jetzt, true) >= k.maxNeueLeadsProTag;
    if (neueLeadsErreicht && bereit.length > 0) bereit = [];
    if (faellig.length === 0 && bereit.length === 0) {
      const grund = erstmails.length === 0 ? 'followups_spaeter' : neueLeadsErreicht && (!k.mitVideo || erstmails.some((l) => l.renderStatus === 'fertig')) ? 'limit_neue_leads' : 'nicht_gerendert';
      result.waiting.push(`${k.id}:${grund}`);
      continue;
    }
    if (result.sent > 0) continue; // höchstens eine Mail pro Durchlauf

    // Kampagnen- und Gesamtgrenzen (Status, Startdatum, Fenster, Kampagnen-Limit, Gesamtlimit über alle Postfächer);
    // Abstand und Quota-Stopp gelten je Postfach (unten)
    const plan = decideSend({
      now: jetzt,
      today: heute,
      campaign: k,
      globalLimit: effektivesGlobalLimit(jetzt),
      sentTodayGlobal: countSentToday(undefined, jetzt),
      sentTodayCampaign: countSentToday(k.id, jetzt),
    });
    if (plan.action === 'wait') {
      result.waiting.push(`${k.id}:${plan.reason}`);
      continue;
    }

    // Fällige Follow-ups zuerst (sie halten den Thread warm), danach neue Erstmails
    let res: SendResult | null = null;
    let ziel = '';
    const wartend = new Set<string>();
    for (const f of faellig) {
      // Follow-ups gehen immer über das Postfach der Erstmail; ist es nicht bereit, wartet das Follow-up
      const pf = postfachFuerLead(f.lead);
      const z = pf ? postfaecher().find((x) => x.absender.id === pf.id)?.zustand : undefined;
      const block = z ? blockiertDurch(z, jetzt.getTime(), heute) : 'kein_postfach';
      if (block) {
        wartend.add(followupWartGrund(block));
        continue;
      }
      ziel = `Follow-up ${f.lead.followupsSent + 1} an Lead ${f.lead.id}`;
      res = await sendFollowup(f.lead.id, { sender: deps.sender, pruefer: deps.pruefer, now: jetzt });
      // Beendeter Flow (Antwort/Bounce) kostet keinen Versand-Slot: nächsten Kandidaten nehmen
      if (!res.ok && (res.kind === 'flow_beendet' || res.kind === 'uebersprungen')) {
        log(`${ziel}: ${res.error}`);
        res = null;
        continue;
      }
      // Postfach ohne Leseberechtigung / nicht nutzbar: dieses Follow-up wartet, andere Postfächer können weitermachen
      if (!res.ok && (res.kind === 'antwort_pruefung_fehlt' || res.kind === 'kein_postfach')) {
        wartend.add(res.kind === 'antwort_pruefung_fehlt' ? 'antwort_pruefung_fehlt' : 'followup_postfach_nicht_verfuegbar');
        res = null;
        continue;
      }
      break;
    }
    if (!res && bereit.length > 0) {
      const wahl = waehlePostfach(postfaecher().map((x) => x.zustand), jetzt.getTime(), heute);
      if (wahl.art === 'warten') wartend.add(wahl.grund);
      else {
        ziel = `Mail an Lead ${bereit[0].id}`;
        res = await sendLead(bereit[0].id, { sender: deps.sender, now: jetzt, absenderId: wahl.id });
      }
    }
    if (!res) {
      for (const g of wartend) result.waiting.push(`${k.id}:${g}`);
      continue;
    }

    if (res.ok) {
      result.sent++;
      // Abstand zur nächsten Mail gilt nur für das Postfach, das gerade gesendet hat
      setzeNaechstenVersand(res.absenderId, jetzt.getTime() + randomGapMs(env.SEND_MIN_GAP_MINUTES, env.SEND_MAX_GAP_MINUTES, deps.zufall));
      log(`${ziel} gesendet (Postfach ${res.absenderId})`);
    } else if (res.kind === 'quota') {
      log(`Quota erreicht – Postfach ${res.absenderId} heute gestoppt: ${res.error}`);
      result.waiting.push(`${k.id}:quota_gestoppt`);
    } else if (res.kind === 'auth' || res.kind === 'nicht_verbunden') {
      // Das Postfach ist jetzt als fehlerhaft markiert und scheidet aus der Rotation aus; andere senden weiter
      result.error = res.error;
      log(`Versand nicht möglich: ${res.error}`);
    } else if (res.kind === 'kein_postfach') {
      result.waiting.push(`${k.id}:kein_postfach`);
      log(`${ziel}: ${res.error}`);
    } else {
      log(`${ziel}: ${res.kind} – ${res.error}`);
    }
  }

  if (result.sent === 0) await pruefeEinenThread(jetzt, deps);
  return result;
}
