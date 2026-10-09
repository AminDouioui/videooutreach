import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { getEnv } from './env';
import { absenderName, absenderSignatur, kannAntwortenPruefen, ladeAbsenderMitId, ladePostfachZustaende, markiereAuthFehler, postfachFuerLead, postfachNichtNutzbar, stoppeQuota, type Absender } from './absender';
import { GmailSendError, pruefeThread, sendRaw, type GmailSender, type ThreadPruefer } from './gmail';
import { buildEmail, buildMime, neueMessageId, oneClickUrl, type BuiltEmail, type MailSchritt } from './mail';
import { FIRMA_HAT_GEANTWORTET, leadStatusLabel, STATUS_SKIP_PREFIX, statusBeendetFlow } from './lead-status';
import { stoppeFirma } from './lead-status-db';
import { rampenLimit } from './rampe';
import { waehlePostfach, type WartGrund } from './rotation';
import { globalDailyLimit, rampeEinstellung } from './settings';
import { kampagnenExtraSpalten } from './campaigns';
import { STANDARD_VARIABLEN, verwendeteVariablen } from './vorlage';
import { isSuppressed } from './suppression';
import { startOfDayBerlinMs, todayBerlin } from './time';
import { kampagneMitVariante, waehleVarianteFuerKampagne } from './varianten-db';

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

/**
 * Absender (Name + Adresse) eines Postfachs. Ohne Postfach (noch keins verbunden): globaler Name und SENDER_EMAIL,
 * damit Vorschauen auch vor dem ersten Verbinden funktionieren.
 */
export function senderInfo(a?: Pick<Absender, 'name' | 'email'> | null): { name: string; email: string } {
  return { name: absenderName(a), email: a?.email ?? getEnv().SENDER_EMAIL ?? '' };
}

/**
 * Normalisierte Extra-Spalten der Kampagne – nur geladen, wenn die Vorlage Platzhalter außerhalb der
 * Standardvariablen nutzt (spart die Abfrage bei einfachen Vorlagen).
 */
function extraSpaltenFuer(campaign: typeof schema.campaigns.$inferSelect, schritt?: MailSchritt): string[] {
  const bekannt = new Set<string>(STANDARD_VARIABLEN);
  const noetig = verwendeteVariablen(`${campaign.emailSubjectTemplate}\n${schritt ? schritt.body : campaign.emailBodyTemplate}`).filter((v) => !bekannt.has(v));
  return noetig.length ? kampagnenExtraSpalten(campaign.id) : [];
}

/**
 * Baut die Mail für einen Lead (Vorschau und Versand nutzen dieselbe Funktion). Mit `schritt` ein Follow-up.
 * Betreff/Text der Erstmail stammen aus der Variante: `variante`, sonst die des Leads (leads.variante), sonst A.
 * Follow-ups bekommen so den „Re: …“-Betreff der Variante, die der Lead erhalten hat.
 */
export function buildLeadEmail(
  lead: typeof schema.leads.$inferSelect,
  kampagne: typeof schema.campaigns.$inferSelect,
  schritt?: MailSchritt,
  variante?: string | null,
  absender?: Absender | null,
): BuiltEmail {
  // Signatur und {{absender_name}} stammen vom Postfach; ohne Angabe das des Leads (Vorschau), sonst das globale
  const postfach = absender === undefined ? postfachFuerLead(lead) : absender;
  const campaign = kampagneMitVariante(kampagne, variante ?? lead.variante);
  return buildEmail(
    lead,
    { ...campaign, extraSpalten: extraSpaltenFuer(campaign, schritt) },
    {
      appUrl: getEnv().APP_URL.replace(/\/$/, ''),
      signature: absenderSignatur(postfach),
      senderName: absenderName(postfach),
    },
    schritt,
  );
}

type MimeOpts = {
  to?: string;
  subjectPrefix?: string;
  schritt?: MailSchritt;
  inReplyTo?: string;
  variante?: string | null;
  /** Postfach, in dessen Namen gesendet wird (From, Name, Message-ID-Domain, List-Unsubscribe-mailto, Signatur) */
  absender: Absender;
};

/** Fertige MIME-Nachricht (base64url) samt ihrer Message-ID. */
export function buildLeadMimeMitId(lead: typeof schema.leads.$inferSelect, campaign: typeof schema.campaigns.$inferSelect, opts: MimeOpts): { raw: string; messageId: string } {
  const mail = buildLeadEmail(lead, campaign, opts.schritt, opts.variante, opts.absender);
  const from = senderInfo(opts.absender);
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
export function buildLeadMime(lead: typeof schema.leads.$inferSelect, campaign: typeof schema.campaigns.$inferSelect, opts: MimeOpts): string {
  return buildLeadMimeMitId(lead, campaign, opts).raw;
}

/** Follow-up-Schritte einer Kampagne in Reihenfolge */
export function ladeFollowups(campaignId: number) {
  return getDb().select().from(schema.followups).where(eq(schema.followups.campaignId, campaignId)).orderBy(asc(schema.followups.position)).all();
}

// ---------------------------------------------------------------- Zähler

/** Heute (Berlin) gesendete Mails inkl. Follow-ups, optional je Kampagne (nurErstmails: nur step 0) – gezählt über sent_messages. */
export function countSentToday(campaignId?: number, jetzt: Date = new Date(), nurErstmails = false): number {
  const von = new Date(startOfDayBerlinMs(jetzt));
  const bedingung = [gte(schema.sentMessages.sentAt, von)];
  if (nurErstmails) bedingung.push(eq(schema.sentMessages.step, 0));
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
  | { ok: true; messageId: string; threadId: string; /** Postfach, über das gesendet wurde */ absenderId: number }
  | {
      ok: false;
      /** Betroffenes Postfach (falls schon feststand) */
      absenderId?: number;
      kind:
        | 'nicht_gefunden'
        | 'bereits_gesendet'
        | 'uebersprungen'
        | 'nicht_gerendert'
        | 'nicht_verbunden'
        | 'kein_postfach'
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
  /** Erstmail: bestimmtes Postfach verwenden (die Schleife wählt per Rotation vorab); sonst wählt sendLead per Rotation */
  absenderId?: number;
  /** Austauschbarer Sender (Tests) */
  sender?: GmailSender;
  /** Austauschbare Antwort-Prüfung (Tests) */
  pruefer?: ThreadPruefer;
  now?: Date;
};

function fehlerInfo(e: unknown) {
  return e instanceof GmailSendError ? e.info : { art: 'sonstig' as const, meldung: e instanceof Error ? e.message : String(e) };
}

const WART_TEXT: Record<WartGrund, string> = {
  kein_postfach: 'Kein aktives, verbundenes Postfach vorhanden',
  postfach_fehler: 'Alle Postfächer haben einen Fehler (bitte neu verbinden)',
  quota_gestoppt: 'Alle Postfächer sind für heute wegen des Gmail-Limits gestoppt',
  limit_postfach: 'Alle Postfächer haben ihr Tageslimit erreicht',
  abstand: 'Der Abstand zur letzten Mail ist noch nicht abgelaufen',
};

/** Postfach für eine Erstmail: das vorgegebene oder per Rotation gewählte. */
function postfachFuerErstmail(opts: SendOptions, jetzt: Date): { absender: Absender } | { fehler: SendResult } {
  if (opts.absenderId !== undefined) {
    const a = ladeAbsenderMitId(opts.absenderId);
    if (!a) return { fehler: { ok: false, kind: 'kein_postfach', error: 'Postfach nicht gefunden' } };
    const grund = postfachNichtNutzbar(a);
    if (grund) return { fehler: { ok: false, kind: 'kein_postfach', absenderId: a.id, error: grund } };
    return { absender: a };
  }
  const alle = ladePostfachZustaende(jetzt);
  if (!alle.some((x) => x.zustand.verbunden)) return { fehler: { ok: false, kind: 'nicht_verbunden', error: 'Gmail nicht verbunden' } };
  // „Jetzt senden“ und direkte Aufrufe ignorieren den Abstand (den prüft die Schleife selbst), nicht aber Limits und Stopps
  const wahl = waehlePostfach(alle.map((x) => x.zustand), jetzt.getTime(), todayBerlin(jetzt), { abstandIgnorieren: true });
  if (wahl.art === 'warten') return { fehler: { ok: false, kind: 'kein_postfach', error: WART_TEXT[wahl.grund] } };
  return { absender: alle.find((x) => x.absender.id === wahl.id)!.absender };
}

/** Quota-/Auth-Fehler betreffen nur das benutzte Postfach. */
function merkePostfachFehler(art: string, meldung: string, absender: Absender, jetzt: Date): void {
  if (art === 'quota') stoppeQuota(absender.id, jetzt);
  else if (art === 'auth') markiereAuthFehler(absender.id, meldung);
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
  // Flow per Lead-Status oder Firmen-Antwort beendet: Erstmail nicht mehr senden
  if (statusBeendetFlow(lead.leadStatus) || lead.flowStopp === 'status' || lead.flowStopp === 'firma_beantwortet') {
    const grund = lead.flowStopp === 'firma_beantwortet' ? FIRMA_HAT_GEANTWORTET : `${STATUS_SKIP_PREFIX}${leadStatusLabel(lead.leadStatus)}`;
    db.update(schema.leads).set({ sendStatus: 'uebersprungen', sendError: grund }).where(eq(schema.leads.id, lead.id)).run();
    return { ok: false, kind: 'uebersprungen', error: grund };
  }
  const kampagne = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
  if (!kampagne) return { ok: false, kind: 'nicht_gefunden', error: 'Kampagne nicht gefunden' };
  if (kampagne.mitVideo && lead.renderStatus !== 'fertig') return { ok: false, kind: 'nicht_gerendert', error: 'Video ist noch nicht fertig gerendert' };

  const sender = opts.sender ?? sendRaw;
  const wahl = postfachFuerErstmail(opts, jetzt);
  if ('fehler' in wahl) return wahl.fehler;
  const postfach = wahl.absender;

  try {
    // Variante der Erstmail: gleichmäßig rotierend unter den aktiven; wird erst mit dem Versand gespeichert
    const variante = waehleVarianteFuerKampagne(kampagne.id);
    const { raw, messageId } = buildLeadMimeMitId(lead, kampagne, { variante, absender: postfach });
    const res = await sender(raw, undefined, postfach);
    db.transaction((tx) => {
      tx.update(schema.leads)
        .set({ sendStatus: 'gesendet', sentAt: jetzt, sendError: null, gmailMessageId: res.id, gmailThreadId: res.threadId, rfcMessageId: messageId, variante, absenderId: postfach.id })
        .where(eq(schema.leads.id, lead.id))
        .run();
      tx.insert(schema.sentMessages)
        .values({ leadId: lead.id, campaignId: lead.campaignId, step: 0, gmailMessageId: res.id, gmailThreadId: res.threadId, absenderId: postfach.id, sentAt: jetzt })
        .run();
    });
    return { ok: true, messageId: res.id, threadId: res.threadId, absenderId: postfach.id };
  } catch (e) {
    const info = fehlerInfo(e);
    merkePostfachFehler(info.art, info.meldung, postfach, jetzt);
    if (info.art === 'quota') {
      // Dieses Postfach ist für heute gestoppt; Lead bleibt geplant und geht über ein anderes Postfach oder morgen raus
      if (lead.sendStatus === 'nicht_gesendet') db.update(schema.leads).set({ sendStatus: 'geplant', sendError: info.meldung }).where(eq(schema.leads.id, lead.id)).run();
      else db.update(schema.leads).set({ sendError: info.meldung }).where(eq(schema.leads.id, lead.id)).run();
      return { ok: false, kind: 'quota', absenderId: postfach.id, error: info.meldung };
    }
    if (info.art === 'auth') {
      // Kein Lead-Fehler: das Postfach ist jetzt pausiert, bis es neu verbunden wird
      return { ok: false, kind: 'auth', absenderId: postfach.id, error: info.meldung };
    }
    db.update(schema.leads).set({ sendStatus: 'fehler', sendError: info.meldung.slice(0, 1000) }).where(eq(schema.leads.id, lead.id)).run();
    return { ok: false, kind: 'fehler', absenderId: postfach.id, error: info.meldung };
  }
}

// ---------------------------------------------------------------- Follow-ups

/** Verständlicher Grund, warum der Flow eines Leads beendet ist */
export function flowStoppText(flowStopp: string | null, leadStatus: string): string {
  switch (flowStopp) {
    case 'bounce':
      return 'Bounce';
    case 'abgemeldet':
      return 'Abgemeldet';
    case 'status':
      return `Lead-Status: ${leadStatusLabel(leadStatus)}`;
    case 'firma_beantwortet':
      return FIRMA_HAT_GEANTWORTET;
    case null:
      return statusBeendetFlow(leadStatus) ? `Lead-Status: ${leadStatusLabel(leadStatus)}` : 'Flow beendet';
    default:
      return 'Lead hat geantwortet';
  }
}

/** Flow für einen Lead beenden (Antwort oder Bounce erkannt) */
export function stoppeFlow(leadId: number, grund: (typeof schema.FLOW_STOPP)[number], jetzt: Date = new Date()): void {
  getDb().update(schema.leads).set({ flowStopp: grund, flowStoppAt: jetzt, replyCheckedAt: jetzt }).where(eq(schema.leads.id, leadId)).run();
}

/**
 * Prüft den Thread eines Leads auf Antwort/Bounce und beendet ggf. den Flow.
 * Liefert true, wenn der Flow (jetzt oder schon vorher) beendet ist. Wirft GmailSendError.
 */
export async function pruefeAntwort(
  lead: typeof schema.leads.$inferSelect,
  pruefer: ThreadPruefer = pruefeThread,
  jetzt: Date = new Date(),
  postfach: Absender | null = postfachFuerLead(lead),
): Promise<boolean> {
  if (lead.flowStopp) return true;
  if (!lead.gmailThreadId) return false;
  // Der Thread liegt im Postfach der Erstmail: nur dort kann geprüft werden
  if (!postfach) throw new GmailSendError({ art: 'sonstig', meldung: 'Postfach der Erstmail nicht gefunden' });
  const ergebnis = await pruefer(lead.gmailThreadId, postfach);
  if (ergebnis === 'antwort') {
    stoppeFlow(lead.id, 'beantwortet', jetzt);
    getDb().update(schema.leads).set({ antwortAt: jetzt, antwortGelesen: false }).where(eq(schema.leads.id, lead.id)).run();
    stoppeFirma(lead.id, jetzt);
  }
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
  if (lead.flowStopp || statusBeendetFlow(lead.leadStatus)) return { ok: false, kind: 'flow_beendet', error: flowStoppText(lead.flowStopp, lead.leadStatus) };
  if (lead.unsubscribed || isSuppressed(lead.email)) {
    stoppeFlow(lead.id, 'abgemeldet', jetzt);
    return { ok: false, kind: 'uebersprungen', error: 'Abgemeldet oder gesperrt' };
  }

  const kampagne = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get();
  if (!kampagne) return { ok: false, kind: 'nicht_gefunden', error: 'Kampagne nicht gefunden' };
  const schritt = ladeFollowups(kampagne.id)[lead.followupsSent];
  if (!schritt) return { ok: false, kind: 'flow_beendet', error: 'Keine weiteren Follow-ups' };

  const sender = opts.sender ?? sendRaw;
  // Immer über das Postfach der Erstmail (der Thread gehört nur dort hin). Ist es pausiert, getrennt, fehlerhaft oder
  // entfernt, wartet das Follow-up – niemals über ein anderes Postfach senden.
  const postfach = postfachFuerLead(lead);
  if (!postfach) return { ok: false, kind: 'kein_postfach', error: 'Das Postfach der Erstmail existiert nicht mehr' };
  const nichtNutzbar = postfachNichtNutzbar(postfach);
  if (nichtNutzbar) return { ok: false, kind: 'kein_postfach', absenderId: postfach.id, error: nichtNutzbar };
  if (!opts.pruefer && !kannAntwortenPruefen(postfach)) {
    return { ok: false, kind: 'antwort_pruefung_fehlt', absenderId: postfach.id, error: `Postfach ${postfach.email} neu verbinden: Antwort-Erkennung braucht die Leseberechtigung für Kopfzeilen` };
  }

  try {
    if (await pruefeAntwort(lead, opts.pruefer, jetzt, postfach)) return { ok: false, kind: 'flow_beendet', error: 'Lead hat geantwortet' };
    const { raw } = buildLeadMimeMitId(lead, kampagne, { schritt: { ...schritt, nr: lead.followupsSent + 1 }, inReplyTo: lead.rfcMessageId ?? undefined, absender: postfach });
    const res = await sender(raw, lead.gmailThreadId, postfach);
    db.transaction((tx) => {
      tx.update(schema.leads)
        .set({ followupsSent: lead.followupsSent + 1, sendError: null })
        .where(eq(schema.leads.id, lead.id))
        .run();
      tx.insert(schema.sentMessages)
        .values({ leadId: lead.id, campaignId: lead.campaignId, step: lead.followupsSent + 1, gmailMessageId: res.id, gmailThreadId: res.threadId, absenderId: postfach.id, sentAt: jetzt })
        .run();
    });
    return { ok: true, messageId: res.id, threadId: res.threadId, absenderId: postfach.id };
  } catch (e) {
    const info = fehlerInfo(e);
    merkePostfachFehler(info.art, info.meldung, postfach, jetzt);
    if (info.art === 'quota') return { ok: false, kind: 'quota', absenderId: postfach.id, error: info.meldung };
    if (info.art === 'auth') return { ok: false, kind: 'auth', absenderId: postfach.id, error: info.meldung };
    // Fehler merken, Flow aber nicht abbrechen: nächster Versuch beim nächsten fälligen Durchlauf
    db.update(schema.leads).set({ sendError: info.meldung.slice(0, 1000) }).where(eq(schema.leads.id, lead.id)).run();
    return { ok: false, kind: 'fehler', absenderId: postfach.id, error: info.meldung };
  }
}

// ---------------------------------------------------------------- Aufwärmrampe

/** Datum (Berlin) der ersten je gesendeten Mail oder null. */
export function ersterVersandTag(): string | null {
  const row = getDb()
    .select({ erste: sql<number | null>`min(${schema.sentMessages.sentAt})` })
    .from(schema.sentMessages)
    .get();
  return row?.erste ? todayBerlin(new Date(row.erste)) : null;
}

/**
 * Effektives globales Tageslimit: ohne aktive Rampe das normale Limit, sonst
 * min(Limit, Start + Schritt * Tage seit Beginn). Beginn: Einstellung, sonst erste gesendete Mail, sonst heute.
 */
export function effektivesGlobalLimit(jetzt: Date = new Date()): number {
  const max = globalDailyLimit();
  const r = rampeEinstellung();
  if (!r.aktiv) return max;
  const heute = todayBerlin(jetzt);
  return rampenLimit({ start: r.start, schritt: r.schritt, beginn: r.beginn ?? ersterVersandTag() ?? heute, heute, max });
}
