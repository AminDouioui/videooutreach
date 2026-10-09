import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });
const jetzt = sql`(unixepoch() * 1000)`;

export const KAMPAGNEN_STATUS = ['entwurf', 'rendert', 'bereit', 'versendet_laufend', 'pausiert', 'abgeschlossen'] as const;
export const RENDER_STATUS = ['wartet', 'rendert', 'fertig', 'fehler'] as const;
export const SEND_STATUS = ['nicht_gesendet', 'geplant', 'gesendet', 'fehler', 'uebersprungen'] as const;
export const EVENT_TYPEN = [
  'page_view',
  'play',
  'progress_25',
  'progress_50',
  'progress_75',
  'progress_100',
  'cta_click',
  'email_open',
  'unsubscribe',
] as const;

/**
 * Absender-Postfächer (Gmail). Erstmails rotieren über die aktiven Postfächer; Follow-ups und Antwortprüfung laufen
 * immer über das Postfach der Erstmail (leads.absender_id). Der Token wird verschlüsselt gespeichert; leer = getrennt.
 */
export const absender = sqliteTable('absender', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  // Anzeigename (null = globaler Absendername aus den Einstellungen)
  name: text('name'),
  // Verschlüsselter Refresh-Token; '' = getrennt/entfernt
  refreshTokenEnc: text('refresh_token_enc').notNull().default(''),
  // Von Google erteilte Berechtigungen (Leerzeichen-getrennt)
  scopes: text('scopes').notNull().default(''),
  tageslimit: integer('tageslimit').notNull().default(30),
  aktiv: integer('aktiv', { mode: 'boolean' }).notNull().default(true),
  // null = globale Signatur aus den Einstellungen
  signatur: text('signatur'),
  // Frühester nächster Versand (Unix-ms) – Abstand gilt je Postfach
  nextSendAt: integer('next_send_at'),
  // Tag ('YYYY-MM-DD', Berlin), an dem ein Quota-Fehler dieses Postfach gestoppt hat
  quotaGestopptAm: text('quota_gestoppt_am'),
  // Letzter Auth-Fehler; gesetzt = Postfach pausiert, bis es neu verbunden wird
  fehler: text('fehler'),
  // Erster Tag der Aufwärmrampe ('YYYY-MM-DD'); null = Tag der ersten Mail dieses Postfachs
  rampeBeginn: text('rampe_beginn'),
  createdAt: ts('created_at').notNull().default(jetzt),
});

export const campaigns = sqliteTable('campaigns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: ts('created_at').notNull().default(jetzt),
  emailSubjectTemplate: text('email_subject_template').notNull(),
  emailBodyTemplate: text('email_body_template').notNull(),
  dailySendLimit: integer('daily_send_limit').notNull().default(30),
  sendWindowStart: text('send_window_start').notNull().default('08:00'),
  sendWindowEnd: text('send_window_end').notNull().default('17:00'),
  // Veraltet: wird nicht mehr ausgewertet (ersetzt durch sendDays), bleibt nur als Spalte bestehen
  sendWeekdaysOnly: integer('send_weekdays_only', { mode: 'boolean' }).notNull().default(true),
  // Versandtage, kommagetrennt (1 = Montag … 7 = Sonntag), z. B. '1,2,3,4,5'
  sendDays: text('send_days').notNull().default('1,2,3,4,5'),
  // Vor diesem Datum ('YYYY-MM-DD', Berlin) wird nicht gesendet; null = sofort
  startDatum: text('start_datum'),
  // Höchstens so viele neue Leads (Erstmails) pro Tag; null = unbegrenzt. Follow-ups zählen nicht.
  maxNeueLeadsProTag: integer('max_neue_leads_pro_tag'),
  ctaUrl: text('cta_url').notNull(),
  trackingPixel: integer('tracking_pixel', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: KAMPAGNEN_STATUS }).notNull().default('entwurf'),
  // false = reine Text-Kampagne: kein Rendern, Versand direkt nach dem Import möglich
  mitVideo: integer('mit_video', { mode: 'boolean' }).notNull().default(true),
  // Antwortet jemand einer Firma, werden die Flows aller anderen Leads mit derselben Domain gestoppt
  stoppBeiFirmenAntwort: integer('stopp_bei_firmen_antwort', { mode: 'boolean' }).notNull().default(true),
});

/** Follow-up-Schritte einer Kampagne (Schritt 1 ist die Erstmail aus campaigns). Gesendet im selben Thread. */
export const followups = sqliteTable(
  'followups',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    // Reihenfolge 1, 2, 3 … (Follow-up 1 = zweite Mail des Flows)
    position: integer('position').notNull(),
    // Wartezeit nach der vorherigen Mail in Tagen
    waitDays: integer('wait_days').notNull().default(3),
    body: text('body').notNull(),
  },
  (t) => [index('followups_campaign_idx').on(t.campaignId)],
);

/**
 * Zusätzliche Varianten (B, C …) der Erstmail für A/B-Tests. Die Kampagnen-Vorlage selbst ist Variante „A“
 * und liegt nicht in dieser Tabelle.
 */
export const varianten = sqliteTable(
  'varianten',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    kuerzel: text('kuerzel').notNull(),
    betreff: text('betreff').notNull(),
    text: text('text').notNull(),
    aktiv: integer('aktiv', { mode: 'boolean' }).notNull().default(true),
    createdAt: ts('created_at').notNull().default(jetzt),
  },
  (t) => [index('varianten_campaign_idx').on(t.campaignId), uniqueIndex('varianten_campaign_kuerzel_idx').on(t.campaignId, t.kuerzel)],
);

// 'status' = Flow per Lead-Status beendet, 'firma_beantwortet' = jemand anderes aus der Firma hat geantwortet
// Muss mit LEAD_STATUS in lib/lead-status.ts übereinstimmen (Test lib/lead-status.test.ts)
export const LEAD_STATUS = ['offen', 'interessiert', 'termin_gebucht', 'spaeter', 'nicht_interessiert', 'falscher_ansprechpartner', 'gewonnen', 'verloren'] as const;
export const FLOW_STOPP = ['beantwortet', 'bounce', 'abgemeldet', 'status', 'firma_beantwortet'] as const;

export const leads = sqliteTable(
  'leads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    firma: text('firma').notNull(),
    anrede: text('anrede'),
    vorname: text('vorname'),
    nachname: text('nachname'),
    email: text('email').notNull(),
    position: text('position'),
    website: text('website'),
    extra: text('extra', { mode: 'json' }).$type<Record<string, string>>(),
    slug: text('slug').notNull().unique(),
    renderStatus: text('render_status', { enum: RENDER_STATUS }).notNull().default('wartet'),
    renderError: text('render_error'),
    videoPath: text('video_path'),
    thumbnailPath: text('thumbnail_path'),
    renderedAt: ts('rendered_at'),
    sendStatus: text('send_status', { enum: SEND_STATUS }).notNull().default('nicht_gesendet'),
    sendError: text('send_error'),
    sentAt: ts('sent_at'),
    gmailMessageId: text('gmail_message_id'),
    gmailThreadId: text('gmail_thread_id'),
    unsubscribed: integer('unsubscribed', { mode: 'boolean' }).notNull().default(false),
    unsubscribedAt: ts('unsubscribed_at'),
    score: integer('score').notNull().default(0),
    notizen: text('notizen'),
    // true = in der Render-Warteschlange („Alle rendern“ setzt es)
    renderRequested: integer('render_requested', { mode: 'boolean' }).notNull().default(false),
    // Message-ID-Header der Erstmail (für In-Reply-To/References der Follow-ups)
    rfcMessageId: text('rfc_message_id'),
    // Anzahl bereits gesendeter Follow-ups
    followupsSent: integer('followups_sent').notNull().default(0),
    // Flow für diesen Lead beendet (Antwort oder Bounce erkannt)
    flowStopp: text('flow_stopp', { enum: FLOW_STOPP }),
    flowStoppAt: ts('flow_stopp_at'),
    replyCheckedAt: ts('reply_checked_at'),
    // Zeitpunkt, an dem die Antwort erkannt wurde
    antwortAt: ts('antwort_at'),
    antwortGelesen: integer('antwort_gelesen', { mode: 'boolean' }).notNull().default(false),
    // Manueller Vertriebsstatus (wie „Lead Status“ bei Instantly)
    leadStatus: text('lead_status', { enum: LEAD_STATUS }).notNull().default('offen'),
    leadStatusAt: ts('lead_status_at'),
    // Kürzel der beim Versand der Erstmail genutzten Variante (A = Kampagnen-Vorlage); null = noch nicht gesendet
    variante: text('variante'),
    // Postfach, über das die Erstmail ging (Follow-ups und Antwortprüfung laufen über dasselbe); null = Altbestand
    absenderId: integer('absender_id').references(() => absender.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(jetzt),
  },
  (t) => [
    index('leads_campaign_idx').on(t.campaignId),
    index('leads_email_idx').on(t.email),
    index('leads_flow_stopp_idx').on(t.flowStopp),
    index('leads_absender_idx').on(t.absenderId),
  ],
);

/** Jede gesendete Mail (Erstmail = step 0, Follow-ups = 1, 2 …); Grundlage der Tageslimits. */
export const sentMessages = sqliteTable(
  'sent_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    leadId: integer('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    step: integer('step').notNull(),
    gmailMessageId: text('gmail_message_id'),
    gmailThreadId: text('gmail_thread_id'),
    // Postfach, von dem die Mail gesendet wurde (Grundlage des Tageslimits je Postfach)
    absenderId: integer('absender_id').references(() => absender.id, { onDelete: 'set null' }),
    sentAt: ts('sent_at').notNull().default(jetzt),
  },
  (t) => [index('sent_messages_lead_idx').on(t.leadId), index('sent_messages_sent_at_idx').on(t.sentAt), index('sent_messages_absender_idx').on(t.absenderId)],
);

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    leadId: integer('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    type: text('type', { enum: EVENT_TYPEN }).notNull(),
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    isBot: integer('is_bot', { mode: 'boolean' }).notNull().default(false),
    createdAt: ts('created_at').notNull().default(jetzt),
  },
  (t) => [index('events_lead_idx').on(t.leadId), index('events_type_created_idx').on(t.type, t.createdAt)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const suppressionList = sqliteTable('suppression_list', {
  email: text('email').primaryKey(),
  reason: text('reason'),
  createdAt: ts('created_at').notNull().default(jetzt),
});

export type Absender = typeof absender.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Variante = typeof varianten.$inferSelect;
export type Followup = typeof followups.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type EventRow = typeof events.$inferSelect;
