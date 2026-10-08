CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`email_subject_template` text NOT NULL,
	`email_body_template` text NOT NULL,
	`daily_send_limit` integer DEFAULT 30 NOT NULL,
	`send_window_start` text DEFAULT '08:00' NOT NULL,
	`send_window_end` text DEFAULT '17:00' NOT NULL,
	`send_weekdays_only` integer DEFAULT true NOT NULL,
	`cta_url` text NOT NULL,
	`tracking_pixel` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'entwurf' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`type` text NOT NULL,
	`meta` text,
	`ip_hash` text,
	`user_agent` text,
	`is_bot` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_lead_idx` ON `events` (`lead_id`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer NOT NULL,
	`firma` text NOT NULL,
	`anrede` text,
	`vorname` text,
	`nachname` text,
	`email` text NOT NULL,
	`position` text,
	`website` text,
	`extra` text,
	`slug` text NOT NULL,
	`render_status` text DEFAULT 'wartet' NOT NULL,
	`render_error` text,
	`video_path` text,
	`thumbnail_path` text,
	`rendered_at` integer,
	`send_status` text DEFAULT 'nicht_gesendet' NOT NULL,
	`send_error` text,
	`sent_at` integer,
	`gmail_message_id` text,
	`gmail_thread_id` text,
	`unsubscribed` integer DEFAULT false NOT NULL,
	`unsubscribed_at` integer,
	`score` integer DEFAULT 0 NOT NULL,
	`notizen` text,
	`render_requested` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_slug_unique` ON `leads` (`slug`);--> statement-breakpoint
CREATE INDEX `leads_campaign_idx` ON `leads` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `leads_email_idx` ON `leads` (`email`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suppression_list` (
	`email` text PRIMARY KEY NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
