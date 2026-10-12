CREATE TABLE `anhaenge` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer NOT NULL,
	`followup_id` integer,
	`dateiname` text NOT NULL,
	`mime` text NOT NULL,
	`groesse` integer NOT NULL,
	`pfad` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`followup_id`) REFERENCES `followups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `anhaenge_campaign_idx` ON `anhaenge` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `anhaenge_followup_idx` ON `anhaenge` (`followup_id`);