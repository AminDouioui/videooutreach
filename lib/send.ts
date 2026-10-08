import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { getEnv } from './env';
import { GmailSendError, isGmailConnected, sendRaw, type GmailSender } from './gmail';
import { buildEmail, buildMime, oneClickUrl, type BuiltEmail } from './mail';
import { getSetting, setSetting } from './settings';
import type { SendState } from './send-plan';
import { isSuppressed } from './suppression';
import { startOfDayBerlinMs, todayBerlin } from './time';

// Gemeinsame Sendefunktion für Worker-Schleife und „Jetzt senden“-API

// ---------------------------------------------------------------- Absender & Mail

export function senderInfo(): { name: string; email: string } {
  const env = getEnv();
  return {
    name: getSetting('sender_name') || env.SENDER_NAME || '',
    email: getSetting('gmail_email') || env.SENDER_EMAIL || '',
  };
}

/** Baut die Mail für einen Lead (Vorschau und Versand nutzen dieselbe Funktion). */
export function buildLeadEmail(lead: typeof schema.leads.$inferSelect, campaign: typeof schema.campaigns.$inferSelect): BuiltEmail {
  return buildEmail(lead, campaign, {
    appUrl: getEnv().APP_URL.replace(/\/$/, ''),
    signature: getSetting('signature') ?? '',
  });
}

/** Fertige MIME-Nachricht (base64url) für einen Empfänger. */
export function buildLeadMime(lead: typeof schema.leads.$inferSelect, campaign: typeof schema.campaigns.$inferSelect, opts: { to?: string; subjectPrefix?: string } = {}): string {
  const mail = buildLeadEmail(lead, campaign);
  const from = senderInfo();
  const appUrl = getEnv().APP_URL.replace(/\/$/, '');
  return buildMime({
    from,
    to: opts.to ?? lead.email,
    subject: `${opts.subjectPrefix ?? ''}${mail.subject}`,
    html: mail.html,
    text: mail.text,
    listUnsubscribeUrl: oneClickUrl(appUrl, lead.slug),
    listUnsubscribeMailto: `mailto:${from.email}?subject=Abmelden`,
  });
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

/** Heute (Berlin) gesendete Mails, optional je Kampagne – gezählt über leads.sent_at. */
export function countSentToday(campaignId?: number, jetzt: Date = new Date()): number {
  const von = new Date(startOfDayBerlinMs(jetzt));
  const bedingung = [eq(schema.leads.sendStatus, 'gesendet'), gte(schema.leads.sentAt, von)];
  if (campaignId !== undefined) bedingung.push(eq(schema.leads.campaignId, campaignId));
  const row = getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(...bedingung))
    .get();
  return row?.n ?? 0;
}

// ---------------------------------------------------------------- sendLead

export type SendResult =
  | { ok: true; messageId: string; threadId: string }
  | { ok: false; kind: 'nicht_gefunden' | 'bereits_gesendet' | 'uebersprungen' | 'nicht_gerendert' | 'nicht_verbunden' | 'quota' | 'auth' | 'fehler'; error: string };

export type SendOptions = {
  /** true = „Jetzt senden“ (ignoriert Fenster/Abstand, die der Aufrufer ohnehin prüft) */
  force?: boolean;
  /** Austauschbarer Sender (Tests) */
  sender?: GmailSender;
  now?: Date;
};

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
  if (lead.renderStatus !== 'fertig') return { ok: false, kind: 'nicht_gerendert', error: 'Video ist noch nicht fertig gerendert' };

  const sender = opts.sender ?? sendRaw;
  if (!opts.sender && !isGmailConnected()) return { ok: false, kind: 'nicht_verbunden', error: 'Gmail nicht verbunden' };

  const kampagne = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
  if (!kampagne) return { ok: false, kind: 'nicht_gefunden', error: 'Kampagne nicht gefunden' };

  try {
    const raw = buildLeadMime(lead, kampagne);
    const res = await sender(raw);
    db.update(schema.leads)
      .set({ sendStatus: 'gesendet', sentAt: jetzt, sendError: null, gmailMessageId: res.id, gmailThreadId: res.threadId })
      .where(eq(schema.leads.id, lead.id))
      .run();
    writeSendState({ sentToday: countSentToday(undefined, jetzt) }, jetzt);
    return { ok: true, messageId: res.id, threadId: res.threadId };
  } catch (e) {
    const info = e instanceof GmailSendError ? e.info : { art: 'sonstig' as const, meldung: e instanceof Error ? e.message : String(e) };
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
