CREATE TABLE `absender` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`refresh_token_enc` text DEFAULT '' NOT NULL,
	`scopes` text DEFAULT '' NOT NULL,
	`tageslimit` integer DEFAULT 30 NOT NULL,
	`aktiv` integer DEFAULT true NOT NULL,
	`signatur` text,
	`next_send_at` integer,
	`quota_gestoppt_am` text,
	`fehler` text,
	`rampe_beginn` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `absender_email_unique` ON `absender` (`email`);--> statement-breakpoint
ALTER TABLE `leads` ADD `absender_id` integer REFERENCES absender(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `leads_absender_idx` ON `leads` (`absender_id`);--> statement-breakpoint
ALTER TABLE `sent_messages` ADD `absender_id` integer REFERENCES absender(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `sent_messages_absender_idx` ON `sent_messages` (`absender_id`);