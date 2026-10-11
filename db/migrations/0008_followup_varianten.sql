CREATE TABLE `followup_varianten` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`followup_id` integer NOT NULL,
	`kuerzel` text NOT NULL,
	`text` text NOT NULL,
	`betreff` text,
	`aktiv` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`followup_id`) REFERENCES `followups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `followup_varianten_followup_idx` ON `followup_varianten` (`followup_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `followup_varianten_kuerzel_idx` ON `followup_varianten` (`followup_id`,`kuerzel`);--> statement-breakpoint
ALTER TABLE `followups` ADD `betreff` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `antwort_thread_id` text;--> statement-breakpoint
ALTER TABLE `sent_messages` ADD `variante` text;--> statement-breakpoint
UPDATE `sent_messages` SET `variante` = 'A' WHERE `step` > 0;--> statement-breakpoint
UPDATE `sent_messages` SET `variante` = (SELECT `variante` FROM `leads` WHERE `leads`.`id` = `sent_messages`.`lead_id`) WHERE `step` = 0;
