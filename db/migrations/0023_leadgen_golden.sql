ALTER TABLE `companies` ADD `mitarbeiter_zahl` integer;--> statement-breakpoint
ALTER TABLE `companies` ADD `mitarbeiter_typ` text;--> statement-breakpoint
ALTER TABLE `companies` ADD `mitarbeiter_klasse` text;--> statement-breakpoint
ALTER TABLE `companies` ADD `branche` text;--> statement-breakpoint
ALTER TABLE `companies` ADD `branche_konfidenz` real;--> statement-breakpoint
ALTER TABLE `companies` ADD `herkunft` text;--> statement-breakpoint
ALTER TABLE `companies` ADD `golden_berechnet_am` integer;--> statement-breakpoint
ALTER TABLE `persons` ADD `rolle` text;--> statement-breakpoint
ALTER TABLE `persons` ADD `rolle_text` text;--> statement-breakpoint
ALTER TABLE `persons` ADD `herkunft` text;--> statement-breakpoint
CREATE TABLE `scores` (
	`company_id` integer PRIMARY KEY NOT NULL,
	`daten_score` integer NOT NULL,
	`icp_score` integer NOT NULL,
	`details` text NOT NULL,
	`berechnet_am` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
