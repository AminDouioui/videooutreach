import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });
const jetzt = sql`(unixepoch() * 1000)`;

// Muss mit VERHALTEN in lib/verhalten.ts übereinstimmen (Test lib/verhalten.test.ts)
export const FOLLOWUP_VERHALTEN = ['immer', 'nicht_angesehen', 'angesehen', 'gestartet', 'komplett', 'termin_klick'] as const;
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
  'abwesenheit',
  'link_click',
  // Klick auf Vorschaubild oder Text-Link zur Video-Seite in der Mail (Route /r/<slug>); meta.grund bei Bot-Heuristik
  'video_link_click',
  // Lead wurde per Untersequenz-Regel in eine andere Kampagne übernommen (meta: zielCampaignId, zielLeadId)
  'untersequenz',
  // Aus einem Verweis in der Antwort wurde ein neuer Lead angelegt (meta: zielLeadId)
  'verweis',
] as const;

/**
 * Absender-Postfächer (Gmail oder SMTP/IMAP, siehe `typ`). Erstmails rotieren über die aktiven Postfächer; Follow-ups und Antwortprüfung laufen
 * immer über das Postfach der Erstmail (leads.absender_id). Gmail: Token verschlüsselt, leer = getrennt. SMTP: Passwörter
 * verschlüsselt in zugangsdaten_enc, leer = getrennt.
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
  // Wieder aktiviert nach dem Bounce-Schutz: nur Erstmails ab diesem Zeitpunkt zählen für die Bounce-Quote
  bounceZaehlenAb: ts('bounce_zaehlen_ab'),
  // Postfach-Typ: 'gmail' (OAuth, Gmail-API) oder 'smtp' (SMTP-Versand + IMAP-Lesen, z. B. Outlook/IONOS/Strato)
  typ: text('typ', { enum: ['gmail', 'smtp'] }).notNull().default('gmail'),
  // Nur typ 'smtp': Server und Benutzer (Passwörter stehen verschlüsselt in zugangsdatenEnc)
  smtpHost: text('smtp_host'),
  smtpPort: integer('smtp_port'),
  // 'ssl' (implizites TLS), 'starttls' oder 'keine' (unverschlüsselt, nur mit Warnhinweis)
  smtpSicherheit: text('smtp_sicherheit', { enum: ['ssl', 'starttls', 'keine'] }),
  smtpBenutzer: text('smtp_benutzer'),
  imapHost: text('imap_host'),
  imapPort: integer('imap_port'),
  imapSicherheit: text('imap_sicherheit', { enum: ['ssl', 'starttls', 'keine'] }),
  imapBenutzer: text('imap_benutzer'),
  // AES-verschlüsseltes JSON {smtpPasswort, imapPasswort}; '' = nicht gesetzt/getrennt
  zugangsdatenEnc: text('zugangsdaten_enc').notNull().default(''),
  // Gesendete Mails zusätzlich per IMAP im „Gesendet“-Ordner ablegen (nötig, wenn der Server das nicht selbst tut)
  imapKopieGesendet: integer('imap_kopie_gesendet', { mode: 'boolean' }).notNull().default(true),
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
  // IANA-Zeitzone der Kampagne (Versandfenster, Versandtage, Startdatum); Leads ohne eigene Zone folgen ihr
  zeitzone: text('zeitzone').notNull().default('Europe/Berlin'),
  // Höchstens so viele neue Leads (Erstmails) pro Tag; null = unbegrenzt. Follow-ups zählen nicht.
  maxNeueLeadsProTag: integer('max_neue_leads_pro_tag'),
  ctaUrl: text('cta_url').notNull(),
  trackingPixel: integer('tracking_pixel', { mode: 'boolean' }).notNull().default(false),
  // Klick-Tracking: http(s)-Links im Mailtext laufen über /api/c/<token> (Event link_click); schadet der Zustellbarkeit leicht
  linkTracking: integer('link_tracking', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: KAMPAGNEN_STATUS }).notNull().default('entwurf'),
  // false = reine Text-Kampagne: kein Rendern, Versand direkt nach dem Import möglich
  mitVideo: integer('mit_video', { mode: 'boolean' }).notNull().default(true),
  // Antwortet jemand einer Firma, werden die Flows aller anderen Leads mit derselben Domain gestoppt
  stoppBeiFirmenAntwort: integer('stopp_bei_firmen_antwort', { mode: 'boolean' }).notNull().default(true),
  // Intro mit Screenshot der Lead-Website (lib/website-screenshot.ts): Der Worker ruft die Website des Leads auf
  websiteScreenshot: integer('website_screenshot', { mode: 'boolean' }).notNull().default(false),
  // A/B-Automatik (lib/ab-auto.ts): deutlich schwächere Erstmail-Varianten (B–E) werden abgeschaltet; abAutoLog = Protokoll der Entscheidungen
  abAuto: integer('ab_auto', { mode: 'boolean' }).notNull().default(false),
  abAutoLog: text('ab_auto_log', { mode: 'json' }).$type<{ at: number; kuerzel: string; grund: string }[]>(),
  // Follow-ups eines Leads mit erkannter Abwesenheitsnotiz um so viele Tage verschieben (0 = nicht verschieben)
  abwesenheitVerschiebenTage: integer('abwesenheit_verschieben_tage').notNull().default(7),
  // Bounce-Schutz: Kampagne pausiert, wenn die Bounce-Quote der letzten `bounceFenster` Erstmails über der Schwelle liegt
  bounceSchutz: integer('bounce_schutz', { mode: 'boolean' }).notNull().default(true),
  bounceSchwelleProzent: integer('bounce_schwelle_prozent').notNull().default(5),
  bounceFenster: integer('bounce_fenster').notNull().default(50),
  // Warum die Kampagne automatisch pausiert wurde (Bounce-Schutz); null = nicht automatisch pausiert
  pausiertGrund: text('pausiert_grund'),
  // Fortsetzen nach dem Bounce-Schutz: nur Erstmails, die ab diesem Zeitpunkt gesendet wurden, zählen für die Quote
  bounceZaehlenAb: ts('bounce_zaehlen_ab'),
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
    // Eigener Betreff von Variante A; gesetzt = Mail als neuer Thread, leer/null = „Re: …“ im Thread der Erstmail
    betreff: text('betreff'),
  },
  (t) => [index('followups_campaign_idx').on(t.campaignId)],
);

/**
 * Dateianhänge der Mails eines Flows: `followupId` null = Erstmail, sonst der Follow-up-Schritt. Gilt für alle Varianten
 * des Schritts. Die Datei liegt unter `${DATA_DIR}/<pfad>` (nie unter /media, nie öffentlich); beim Löschen des
 * Datensatzes (auch per Cascade) wird die Datei über lib/anhaenge-db.ts mitgelöscht.
 */
export const anhaenge = sqliteTable(
  'anhaenge',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    followupId: integer('followup_id').references(() => followups.id, { onDelete: 'cascade' }),
    // Originalname, bereinigt (nur zur Anzeige und als Dateiname in der Mail)
    dateiname: text('dateiname').notNull(),
    mime: text('mime').notNull(),
    // Größe in Byte
    groesse: integer('groesse').notNull(),
    // Relativ zu DATA_DIR, z. B. anhaenge/12/ab12cd34ef56ab78-Angebot.pdf
    pfad: text('pfad').notNull(),
    createdAt: ts('created_at').notNull().default(jetzt),
  },
  (t) => [index('anhaenge_campaign_idx').on(t.campaignId), index('anhaenge_followup_idx').on(t.followupId)],
);

/**
 * Zusätzliche Varianten (B–E) eines Follow-up-Schritts. Variante A ist followups.body/betreff selbst.
 * `betreff` gesetzt = diese Variante geht als neuer Thread raus.
 */
export const followupVarianten = sqliteTable(
  'followup_varianten',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    followupId: integer('followup_id')
      .notNull()
      .references(() => followups.id, { onDelete: 'cascade' }),
    kuerzel: text('kuerzel').notNull(),
    text: text('text').notNull(),
    betreff: text('betreff'),
    aktiv: integer('aktiv', { mode: 'boolean' }).notNull().default(true),
    // Für welches Verhalten des Leads diese Variante gilt (lib/verhalten.ts); 'immer' = normale A/B-Rotation
    verhalten: text('verhalten', { enum: FOLLOWUP_VERHALTEN }).notNull().default('immer'),
  },
  (t) => [index('followup_varianten_followup_idx').on(t.followupId), uniqueIndex('followup_varianten_kuerzel_idx').on(t.followupId, t.kuerzel)],
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
    // IANA-Zeitzone des Leads (Versandfenster/-tage gelten dort); null = Zeitzone der Kampagne
    zeitzone: text('zeitzone'),
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
    // Abwesenheitsnotiz erkannt (zählt nicht als Antwort); Follow-ups warten bis abwesendBis (null = nicht verschoben)
    abwesendAt: ts('abwesend_at'),
    abwesendBis: ts('abwesend_bis'),
    // KI liest das Rückkehrdatum aus der Notiz: Zeitpunkt der Auswertung und Fehlversuche (höchstens 3)
    // Score hat die Heiß-Schwelle erreicht (einmal je Lead, löst den Webhook heisser_lead aus)
    heissAt: ts('heiss_at'),
    abwesendKiAt: ts('abwesend_ki_at'),
    abwesendKiVersuche: integer('abwesend_ki_versuche').notNull().default(0),
    // Einwand aus der Antwort (lib/einwaende.ts), vom Worker per KI erkannt
    kiEinwand: text('ki_einwand'),
    // „Melden Sie sich im Herbst“: Datum der Wiedervorlage und wann sie ausgelöst wurde (Antwort wird wieder ungelesen, Entwurf liegt bereit)
    wiedervorlageAt: ts('wiedervorlage_at'),
    wiedervorlageErledigtAt: ts('wiedervorlage_erledigt_at'),
    // „Wenden Sie sich an Frau Meier“: von der KI gelesener Verweis; angelegtLeadId = daraus entstandener Lead
    kiVerweis: text('ki_verweis', { mode: 'json' }).$type<{ name: string | null; email: string | null; position: string | null; angelegtLeadId?: number }>(),
    // Automatisch erstellter Antwort-Entwurf (wird nie gesendet, liegt im Antwortfeld der Unibox bereit)
    kiEntwurf: text('ki_entwurf', { mode: 'json' }).$type<{ text: string; at: number; verstoesse?: number }>(),
    // Manueller Vertriebsstatus (wie „Lead Status“ bei Instantly)
    leadStatus: text('lead_status', { enum: LEAD_STATUS }).notNull().default('offen'),
    leadStatusAt: ts('lead_status_at'),
    // Kürzel der beim Versand der Erstmail genutzten Variante (A = Kampagnen-Vorlage); null = noch nicht gesendet
    variante: text('variante'),
    // Thread, in dem die Antwort erkannt wurde (null = Thread der Erstmail; abweichend bei Follow-ups als neuer Thread)
    antwortThreadId: text('antwort_thread_id'),
    // KI-Einordnung der Antwort (optional, mit ANTHROPIC_API_KEY oder OPENROUTER_API_KEY): kategorie, konfidenz, begruendung, at, angewendet, modell (womit eingeordnet)
    kiEinordnung: text('ki_einordnung', { mode: 'json' }).$type<{ kategorie: string; konfidenz: number; begruendung: string; at: number; angewendet?: boolean; modell?: 'jev' | 'anthropic' }>(),
    // Fehlversuche der automatischen Einordnung (höchstens 3) und Zeitpunkt des letzten Versuchs
    kiVersuche: integer('ki_versuche').notNull().default(0),
    kiVersuchAt: ts('ki_versuch_at'),
    // Postfach, über das die Erstmail ging (Follow-ups und Antwortprüfung laufen über dasselbe); null = Altbestand
    absenderId: integer('absender_id').references(() => absender.id, { onDelete: 'set null' }),
    // Pipeline (CRM light): Deal-Wert in Cent (null = keiner) und Notiz zum Deal
    dealWert: integer('deal_wert'),
    dealNotiz: text('deal_notiz'),
    // Per Untersequenz übernommen: Lead, aus dem dieser Datensatz kopiert wurde (null = importiert/angelegt)
    herkunftLeadId: integer('herkunft_lead_id').references((): AnySQLiteColumn => leads.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(jetzt),
  },
  (t) => [
    index('leads_herkunft_idx').on(t.herkunftLeadId),
    index('leads_campaign_idx').on(t.campaignId),
    index('leads_email_idx').on(t.email),
    index('leads_flow_stopp_idx').on(t.flowStopp),
    index('leads_absender_idx').on(t.absenderId),
  ],
);

/**
 * Untersequenz-Regeln: Wird ein Lead der Quell-Kampagne auf `ausloeserStatus` gesetzt, wird er (als Kopie) in die
 * Ziel-Kampagne übernommen, wo der Flow neu startet.
 */
export const untersequenzen = sqliteTable(
  'untersequenzen',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    ausloeserStatus: text('ausloeser_status', { enum: LEAD_STATUS }).notNull(),
    zielCampaignId: integer('ziel_campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    aktiv: integer('aktiv', { mode: 'boolean' }).notNull().default(true),
    createdAt: ts('created_at').notNull().default(jetzt),
  },
  (t) => [index('untersequenzen_campaign_idx').on(t.campaignId), uniqueIndex('untersequenzen_regel_idx').on(t.campaignId, t.ausloeserStatus, t.zielCampaignId)],
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
    // Kürzel der genutzten Variante (Erstmail und Follow-ups); null = Altbestand (zählt als A)
    variante: text('variante'),
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

// ---------------------------------------------------------------- Webhooks & API (Paket 14)

export const WEBHOOK_EREIGNISSE = ['mail_gesendet', 'antwort', 'bounce', 'abwesenheit', 'abmeldung', 'lead_status', 'video_angesehen', 'video_gestartet', 'termin_klick', 'link_klick', 'video_klick', 'heisser_lead', 'wiedervorlage'] as const;
export const ZUSTELL_STATUS = ['offen', 'ok', 'fehler'] as const;
export const API_RECHTE = ['lesen', 'schreiben'] as const;

/** Ausgehende Webhooks. Das Geheimnis (HMAC-Signatur) wird mit lib/crypto.ts verschlüsselt gespeichert. */
export const webhooks = sqliteTable('webhooks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  url: text('url').notNull(),
  ereignisse: text('ereignisse', { mode: 'json' }).$type<string[]>().notNull(),
  geheimnis: text('geheimnis').notNull(),
  aktiv: integer('aktiv', { mode: 'boolean' }).notNull().default(true),
  createdAt: ts('created_at').notNull().default(jetzt),
});

/** Zustellungen (Warteschlange und Protokoll). 'test' ist zusätzlich zu den Ereignissen der Liste möglich. */
export const webhookZustellungen = sqliteTable(
  'webhook_zustellungen',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    webhookId: integer('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    ereignis: text('ereignis').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: ZUSTELL_STATUS }).notNull().default('offen'),
    versuche: integer('versuche').notNull().default(0),
    naechsterVersuchAt: ts('naechster_versuch_at'),
    letzterFehler: text('letzter_fehler'),
    httpStatus: integer('http_status'),
    createdAt: ts('created_at').notNull().default(jetzt),
    zugestelltAt: ts('zugestellt_at'),
  },
  (t) => [index('webhook_zustellungen_webhook_idx').on(t.webhookId, t.createdAt), index('webhook_zustellungen_faellig_idx').on(t.status, t.naechsterVersuchAt)],
);

/** API-Schlüssel der REST-API. Nur der sha256-Hash wird gespeichert; `praefix` (erste 8 Zeichen) dient der Anzeige. */
export const apiSchluessel = sqliteTable('api_schluessel', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  praefix: text('praefix').notNull(),
  hash: text('hash').notNull().unique(),
  rechte: text('rechte', { enum: API_RECHTE }).notNull().default('lesen'),
  letzteNutzungAt: ts('letzte_nutzung_at'),
  createdAt: ts('created_at').notNull().default(jetzt),
  widerrufenAt: ts('widerrufen_at'),
});

export const BENUTZER_ROLLEN = ['admin', 'mitglied', 'lesen'] as const;

/**
 * Team-Zugänge. Der Zugang über ADMIN_PASSWORD ist kein Benutzer in dieser Tabelle (Session mit benutzerId 0).
 * `sessionVersion` steckt im Session-Token; wer sie erhöht (Deaktivieren, Rollenwechsel, Passwortwechsel), entwertet
 * alle bestehenden Sessions des Benutzers sofort.
 */
export const benutzer = sqliteTable('benutzer', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Immer klein geschrieben gespeichert
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  // scrypt, Format `salz:hash` (hex), siehe lib/passwort.ts
  passwortHash: text('passwort_hash').notNull(),
  rolle: text('rolle', { enum: BENUTZER_ROLLEN }).notNull().default('mitglied'),
  aktiv: integer('aktiv', { mode: 'boolean' }).notNull().default(true),
  sessionVersion: integer('session_version').notNull().default(0),
  letzterLoginAt: ts('letzter_login_at'),
  createdAt: ts('created_at').notNull().default(jetzt),
});

/** Einmal-Einladungen (auch für „Passwort zurücksetzen“). Nur der sha256-Hash des Tokens wird gespeichert. */
export const einladungen = sqliteTable(
  'einladungen',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    email: text('email').notNull(),
    rolle: text('rolle', { enum: BENUTZER_ROLLEN }).notNull().default('mitglied'),
    tokenHash: text('token_hash').notNull().unique(),
    ablaufAt: ts('ablauf_at').notNull(),
    angenommenAt: ts('angenommen_at'),
    createdAt: ts('created_at').notNull().default(jetzt),
  },
  (t) => [index('einladungen_email_idx').on(t.email)],
);

export type Benutzer = typeof benutzer.$inferSelect;
export type Einladung = typeof einladungen.$inferSelect;
export type BenutzerRolle = (typeof BENUTZER_ROLLEN)[number];

export type Absender = typeof absender.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Variante = typeof varianten.$inferSelect;
export type Followup = typeof followups.$inferSelect;
export type Anhang = typeof anhaenge.$inferSelect;
export type FollowupVariante = typeof followupVarianten.$inferSelect;
export type Untersequenz = typeof untersequenzen.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type EventRow = typeof events.$inferSelect;
