import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { getEnv } from './env';
import { GmailSendError, isGmailConnected, kannAntwortenPruefen, pruefeThread, sendRaw, type GmailSender, type ThreadPruefer } from './gmail';
import { buildEmail, buildMime, neueMessageId, oneClickUrl, type BuiltEmail, type MailSchritt } from './mail';
import { getSetting, setSetting } from './settings';
import type { SendState } from './send-plan';
import { isSuppressed } from './suppression';
import { startOfDayBerlinMs, todayBerlin } from './time';

// Gemeinsame Sendefunktion für Worker-Schleife und „Jetzt senden“-API

// ---------------------------------------------------------------- Versand abbrechen

/**
 * Versand der Kampagne abbrechen: geplante Leads zurück auf 'nicht_gesendet', Kampagne zurück auf
 * 'rendert' (falls noch Videos anstehen) bzw. 'bereit'. Bereits gesendete Mails bleiben unberührt.
 */
export function brecheVersandAb(campaignId: number): number {
  const db = getDb();
  return db.transaction((tx) => {
    const res = tx
      .update(schema.leads)
      .set({ sendStatus: 'nicht_gesendet' })
      .where(and(eq(schema.leads.campaignId, campaignId), eq(schema.leads.sendStatus, 'geplant')))
      .run();
    const offen =
      tx
        .select({ n: sql<number>`count(*)` })
        .from(schema.leads)
        .where(and(eq(schema.leads.campaignId, campaignId), sql`(${schema.leads.renderStatus} = 'rendert' or (${schema.leads.renderStatus} = 'wartet' and ${schema.leads.renderRequested} = 1))`))
        .get()?.n ?? 0;
    tx.update(schema.campaigns)
      .set({ status: offen > 0 ? 'rendert' : 'bereit' })
      .where(eq(schema.campaigns.id, campaignId))
      .run();
    return res.changes;
  });
}

// ---------------------------------------------------------------- Absender & Mail

export function senderInfo(): { name: string; email: string } {
  const env = getEnv();
  return {
    name: getSetting('sender_name') || env.SENDER_NAME || '',
    email: getSetting('gmail_email') || env.SENDER_EMAIL || '',
  };
}

/** Baut die Mail für einen Lead (Vorschau und Versand nutzen dieselbe Funktion). Mit `schritt` ein Follow-up. */
export function buildLeadEmail(lead: typeof schema.leads.$inferSelect, campaign: typeof schema.campaigns.$inferSelect, schritt?: MailSchritt): BuiltEmail {
  return buildEmail(
    lead,
    campaign,
    {
      appUrl: getEnv().APP_URL.replace(/\/$/, ''),
      signature: getSetting('signature') ?? '',
    },
    schritt,
  );
}

type MimeOpts = { to?: string; subjectPrefix?: string; schritt?: MailSchritt; inReplyTo?: string };

/** Fertige MIME-Nachricht (base64url) samt ihrer Message-ID. */
export function buildLeadMimeMitId(lead: typeof schema.leads.$inferSelect, campaign: typeof schema.campaigns.$inferSelect, opts: MimeOpts = {}): { raw: string; messageId: string } {
  const mail = buildLeadEmail(lead, campaign, opts.schritt);
  const from = senderInfo();
  const appUrl = getEnv().APP_URL.replace(/\/$/, '');
  const messageId = neueMessageId(from.email);
  const raw = buildMime({
    from,
    to: opts.to ?? lead.email,
    subject: `${opts.subjectPrefix ?? ''}${mail.subject}`,
    html: mail.html,
    text: mail.text,
    listUnsubscribeUrl: oneClickUrl(appUrl, lead.slug),
    listUnsubscribeMailto: `mailto:${from.email}?subject=Abmelden`,
    inReplyTo: opts.inReplyTo,
    messageId,
  });
  return { raw, messageId };
}

/** Fertige MIME-Nachricht (base64url) für einen Empfänger. */
export function buildLeadMime(lead: typeof schema.leads.$inferSelect, campaign: typeof schema.campaigns.$inferSelect, opts: MimeOpts = {}): string {
  return buildLeadMimeMitId(lead, campaign, opts).raw;
}

/** Follow-up-Schritte einer Kampagne in Reihenfolge */
export function ladeFollowups(campaignId: number) {
  return getDb().select().from(schema.followups).where(eq(schema.followups.campaignId, campaignId)).orderBy(asc(schema.followups.position)).all();
}

// ---------------------------------------------------------------- send_state

export function readSendState(jetzt: Date = new Date()): SendState {
  const heute = todayBerlin(jetzt);
  let s: Partial<SendState> = {};
  try {
    s = JSON.parse(getSetting('send_state') ?? '{}') as Partial<SendState>;
  } catch {
    s = {};
  }
  return {
    date: s.date ?? heute,
    sentToday: s.date === heute ? (s.sentToday ?? 0) : 0,
    nextSendAt: typeof s.nextSendAt === 'number' ? s.nextSendAt : null,
    quotaStoppedDate: s.quotaStoppedDate ?? null,
  };
}

export function writeSendState(patch: Partial<SendState>, jetzt: Date = new Date()): SendState {
  const neu = { ...readSendState(jetzt), ...patch, date: todayBerlin(jetzt) };
  setSetting('send_state', JSON.stringify(neu));
  return neu;
}

/** Heute (Berlin) gesendete Mails inkl. Follow-ups, optional je Kampagne – gezählt über sent_messages. */
export function countSentToday(campaignId?: number, jetzt: Date = new Date()): number {
  const von = new Date(startOfDayBerlinMs(jetzt));
  const bedingung = [gte(schema.sentMessages.sentAt, von)];
  if (campaignId !== undefined) bedingung.push(eq(schema.sentMessages.campaignId, campaignId));
  const row = getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.sentMessages)
    .where(and(...bedingung))
    .get();
  return row?.n ?? 0;
}

// ---------------------------------------------------------------- sendLead

export type SendResult =
  | { ok: true; messageId: string; threadId: string }
  | {
      ok: false;
      kind:
        | 'nicht_gefunden'
        | 'bereits_gesendet'
        | 'uebersprungen'
        | 'nicht_gerendert'
        | 'nicht_verbunden'
        | 'quota'
        | 'auth'
        | 'fehler'
        | 'flow_beendet'
        | 'antwort_pruefung_fehlt';
      error: string;
    };

export type SendOptions = {
  /** true = „Jetzt senden“ (ignoriert Fenster/Abstand, die der Aufrufer ohnehin prüft) */
  force?: boolean;
  /** Austauschbarer Sender (Tests) */
  sender?: GmailSender;
  /** Austauschbare Antwort-Prüfung (Tests) */
  pruefer?: ThreadPruefer;
  now?: Date;
};

function fehlerInfo(e: unknown) {
  return e instanceof GmailSendError ? e.info : { art: 'sonstig' as const, meldung: e instanceof Error ? e.message : String(e) };
}

/**
 * Sendet die Mail an einen Lead und aktualisiert dessen Status.
 * Prüft Sperrliste/Abmeldung/Renderstatus. Fenster, Limits und Abstand prüft die Worker-Schleife.
 */
export async function sendLead(leadId: number, opts: SendOptions = {}): Promise<SendResult> {
  const db = getDb();
  const jetzt = opts.now ?? new Date();
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead) return { ok: false, kind: 'nicht_gefunden', error: 'Lead nicht gefunden' };
  if (lead.sendStatus === 'gesendet') return { ok: false, kind: 'bereits_gesendet', error: 'Bereits gesendet' };

  // Sperrliste / Abmeldung hat immer Vorrang
  if (lead.unsubscribed || isSuppressed(lead.email)) {
    const grund = lead.unsubscribed ? 'Abgemeldet' : 'Auf der Sperrliste';
    db.update(schema.leads).set({ sendStatus: 'uebersprungen', sendError: grund }).where(eq(schema.leads.id, lead.id)).run();
    return { ok: false, kind: 'uebersprungen', error: grund };
  }
  const kampagne = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
  if (!kampagne) return { ok: false, kind: 'nicht_gefunden', error: 'Kampagne nicht gefunden' };
  if (kampagne.mitVideo && lead.renderStatus !== 'fertig') return { ok: false, kind: 'nicht_gerendert', error: 'Video ist noch nicht fertig gerendert' };

  const sender = opts.sender ?? sendRaw;
  if (!opts.sender && !isGmailConnected()) return { ok: false, kind: 'nicht_verbunden', error: 'Gmail nicht verbunden' };

  try {
    const { raw, messageId } = buildLeadMimeMitId(lead, kampagne);
    const res = await sender(raw);
    db.transaction((tx) => {
      tx.update(schema.leads)
        .set({ sendStatus: 'gesendet', sentAt: jetzt, sendError: null, gmailMessageId: res.id, gmailThreadId: res.threadId, rfcMessageId: messageId })
        .where(eq(schema.leads.id, lead.id))
        .run();
      tx.insert(schema.sentMessages)
        .values({ leadId: lead.id, campaignId: lead.campaignId, step: 0, gmailMessageId: res.id, gmailThreadId: res.threadId, sentAt: jetzt })
        .run();
    });
    writeSendState({ sentToday: countSentToday(undefined, jetzt) }, jetzt);
    return { ok: true, messageId: res.id, threadId: res.threadId };
  } catch (e) {
    const info = fehlerInfo(e);
    if (info.art === 'quota') {
      // Versand für heute stoppen; Lead bleibt geplant
      writeSendState({ quotaStoppedDate: todayBerlin(jetzt) }, jetzt);
      if (lead.sendStatus === 'nicht_gesendet') db.update(schema.leads).set({ sendStatus: 'geplant', sendError: info.meldung }).where(eq(schema.leads.id, lead.id)).run();
      else db.update(schema.leads).set({ sendError: info.meldung }).where(eq(schema.leads.id, lead.id)).run();
      return { ok: false, kind: 'quota', error: info.meldung };
    }
    if (info.art === 'auth') {
      // Kein Lead-Fehler: Verbindung muss repariert werden
      return { ok: false, kind: 'auth', error: info.meldung };
    }
    db.update(schema.leads).set({ sendStatus: 'fehler', sendError: info.meldung.slice(0, 1000) }).where(eq(schema.leads.id, lead.id)).run();
    return { ok: false, kind: 'fehler', error: info.meldung };
  }
}

// ---------------------------------------------------------------- Follow-ups

/** Flow für einen Lead beenden (Antwort oder Bounce erkannt) */
export function stoppeFlow(leadId: number, grund: (typeof schema.FLOW_STOPP)[number], jetzt: Date = new Date()): void {
  getDb().update(schema.leads).set({ flowStopp: grund, flowStoppAt: jetzt, replyCheckedAt: jetzt }).where(eq(schema.leads.id, leadId)).run();
}

/**
 * Prüft den Thread eines Leads auf Antwort/Bounce und beendet ggf. den Flow.
 * Liefert true, wenn der Flow (jetzt oder schon vorher) beendet ist. Wirft GmailSendError.
 */
export async function pruefeAntwort(lead: typeof schema.leads.$inferSelect, pruefer: ThreadPruefer = pruefeThread, jetzt: Date = new Date()): Promise<boolean> {
  if (lead.flowStopp) return true;
  if (!lead.gmailThreadId) return false;
  const ergebnis = await pruefer(lead.gmailThreadId);
  if (ergebnis === 'antwort') stoppeFlow(lead.id, 'beantwortet', jetzt);
  else if (ergebnis === 'bounce') stoppeFlow(lead.id, 'bounce', jetzt);
  else getDb().update(schema.leads).set({ replyCheckedAt: jetzt }).where(eq(schema.leads.id, lead.id)).run();
  return ergebnis !== null;
}

/**
 * Sendet das nächste Follow-up eines Leads als Antwort im Thread der Erstmail.
 * Vorher wird der Thread auf Antworten geprüft: Hat der Lead geantwortet (oder ist die Mail gebounct), endet der Flow.
 * Ohne Lese-Berechtigung wird nichts gesendet (lieber kein Follow-up als eins an jemanden, der schon geantwortet hat).
 */
export async function sendFollowup(leadId: number, opts: SendOptions = {}): Promise<SendResult> {
  const db = getDb();
  const jetzt = opts.now ?? new Date();
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead) return { ok: false, kind: 'nicht_gefunden', error: 'Lead nicht gefunden' };
  if (lead.sendStatus !== 'gesendet' || !lead.gmailThreadId) return { ok: false, kind: 'nicht_gefunden', error: 'Erstmail noch nicht gesendet' };
  if (lead.flowStopp) return { ok: false, kind: 'flow_beendet', error: lead.flowStopp === 'bounce' ? 'Bounce' : 'Lead hat geantwortet' };
  if (lead.unsubscribed || isSuppressed(lead.email)) {
    stoppeFlow(lead.id, 'abgemeldet', jetzt);
    return { ok: false, kind: 'uebersprungen', error: 'Abgemeldet oder gesperrt' };
  }

  const kampagne = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
  if (!kampagne) return { ok: false, kind: 'nicht_gefunden', error: 'Kampagne nicht gefunden' };
  const schritt = ladeFollowups(kampagne.id)[lead.followupsSent];
  if (!schritt) return { ok: false, kind: 'flow_beendet', error: 'Keine weiteren Follow-ups' };

  const sender = opts.sender ?? sendRaw;
  if (!opts.sender && !isGmailConnected()) return { ok: false, kind: 'nicht_verbunden', error: 'Gmail nicht verbunden' };
  if (!opts.pruefer && !kannAntwortenPruefen()) {
    return { ok: false, kind: 'antwort_pruefung_fehlt', error: 'Gmail neu verbinden: Antwort-Erkennung braucht die Leseberechtigung für Kopfzeilen' };
  }

  try {
    if (await pruefeAntwort(lead, opts.pruefer, jetzt)) return { ok: false, kind: 'flow_beendet', error: 'Lead hat geantwortet' };
    const { raw } = buildLeadMimeMitId(lead, kampagne, { schritt, inReplyTo: lead.rfcMessageId ?? undefined });
    const res = await sender(raw, lead.gmailThreadId);
    db.transaction((tx) => {
      tx.update(schema.leads)
        .set({ followupsSent: lead.followupsSent + 1, sendError: null })
        .where(eq(schema.leads.id, lead.id))
        .run();
      tx.insert(schema.sentMessages)
        .values({ leadId: lead.id, campaignId: lead.campaignId, step: lead.followupsSent + 1, gmailMessageId: res.id, gmailThreadId: res.threadId, sentAt: jetzt })
        .run();
    });
    writeSendState({ sentToday: countSentToday(undefined, jetzt) }, jetzt);
    return { ok: true, messageId: res.id, threadId: res.threadId };
  } catch (e) {
    const info = fehlerInfo(e);
    if (info.art === 'quota') {
      writeSendState({ quotaStoppedDate: todayBerlin(jetzt) }, jetzt);
      return { ok: false, kind: 'quota', error: info.meldung };
    }
    if (info.art === 'auth') return { ok: false, kind: 'auth', error: info.meldung };
    // Fehler merken, Flow aber nicht abbrechen: nächster Versuch beim nächsten fälligen Durchlauf
    db.update(schema.leads).set({ sendError: info.meldung.slice(0, 1000) }).where(eq(schema.leads.id, lead.id)).run();
    return { ok: false, kind: 'fehler', error: info.meldung };
  }
}
