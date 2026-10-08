import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

export const campaigns = sqliteTable('campaigns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: ts('created_at').notNull().default(jetzt),
  emailSubjectTemplate: text('email_subject_template').notNull(),
  emailBodyTemplate: text('email_body_template').notNull(),
  dailySendLimit: integer('daily_send_limit').notNull().default(30),
  sendWindowStart: text('send_window_start').notNull().default('08:00'),
  sendWindowEnd: text('send_window_end').notNull().default('17:00'),
  sendWeekdaysOnly: integer('send_weekdays_only', { mode: 'boolean' }).notNull().default(true),
  ctaUrl: text('cta_url').notNull(),
  trackingPixel: integer('tracking_pixel', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: KAMPAGNEN_STATUS }).notNull().default('entwurf'),
});

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
    createdAt: ts('created_at').notNull().default(jetzt),
  },
  (t) => [index('leads_campaign_idx').on(t.campaignId), index('leads_email_idx').on(t.email)],
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
  (t) => [index('events_lead_idx').on(t.leadId)],
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

export type Campaign = typeof campaigns.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type EventRow = typeof events.$inferSelect;
