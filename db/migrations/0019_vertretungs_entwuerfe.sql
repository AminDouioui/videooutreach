CREATE TABLE `vertretungs_entwuerfe` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`kategorie` text NOT NULL,
	`an` text NOT NULL,
	`betreff` text NOT NULL,
	`text` text NOT NULL,
	`erledigt_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vertretungs_entwuerfe_lead_id_unique` ON `vertretungs_entwuerfe` (`lead_id`);--> statement-breakpoint
CREATE INDEX `vertretung_erledigt_idx` ON `vertretungs_entwuerfe` (`erledigt_at`);
