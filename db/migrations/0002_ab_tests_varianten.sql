CREATE TABLE `varianten` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer NOT NULL,
	`kuerzel` text NOT NULL,
	`betreff` text NOT NULL,
	`text` text NOT NULL,
	`aktiv` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `varianten_campaign_idx` ON `varianten` (`campaign_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `varianten_campaign_kuerzel_idx` ON `varianten` (`campaign_id`,`kuerzel`);--> statement-breakpoint
ALTER TABLE `leads` ADD `variante` text;--> statement-breakpoint
UPDATE `leads` SET `variante` = 'A' WHERE `send_status` = 'gesendet';
