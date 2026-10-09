CREATE TABLE `followups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer NOT NULL,
	`position` integer NOT NULL,
	`wait_days` integer DEFAULT 3 NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `followups_campaign_idx` ON `followups` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `sent_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`campaign_id` integer NOT NULL,
	`step` integer NOT NULL,
	`gmail_message_id` text,
	`gmail_thread_id` text,
	`sent_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sent_messages_lead_idx` ON `sent_messages` (`lead_id`);--> statement-breakpoint
CREATE INDEX `sent_messages_sent_at_idx` ON `sent_messages` (`sent_at`);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `mit_video` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `rfc_message_id` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `followups_sent` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `flow_stopp` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `flow_stopp_at` integer;--> statement-breakpoint
ALTER TABLE `leads` ADD `reply_checked_at` integer;--> statement-breakpoint
-- Bereits gesendete Erstmails übernehmen (Tageslimits zählen ab jetzt über sent_messages)
INSERT INTO `sent_messages` (`lead_id`, `campaign_id`, `step`, `gmail_message_id`, `gmail_thread_id`, `sent_at`) SELECT `id`, `campaign_id`, 0, `gmail_message_id`, `gmail_thread_id`, `sent_at` FROM `leads` WHERE `send_status` = 'gesendet' AND `sent_at` IS NOT NULL;
