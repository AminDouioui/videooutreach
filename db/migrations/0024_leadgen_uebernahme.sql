ALTER TABLE `leads` ADD `leadgen_company_id` integer;--> statement-breakpoint
ALTER TABLE `leads` ADD `leadgen_person_id` integer;--> statement-breakpoint
CREATE INDEX `leads_leadgen_company_idx` ON `leads` (`leadgen_company_id`);--> statement-breakpoint
CREATE TABLE `person_sperre` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hash` text NOT NULL,
	`grund` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_sperre_hash_unique` ON `person_sperre` (`hash`);--> statement-breakpoint
CREATE TABLE `leadgen_uebernahmen` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer,
	`company_id` integer NOT NULL,
	`person_id` integer,
	`lead_id` integer,
	`campaign_id` integer NOT NULL,
	`email` text,
	`herkunft` text NOT NULL,
	`benutzer` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `leadgen_uebernahmen_lead_idx` ON `leadgen_uebernahmen` (`lead_id`);--> statement-breakpoint
CREATE INDEX `leadgen_uebernahmen_company_idx` ON `leadgen_uebernahmen` (`company_id`);
--> statement-breakpoint
CREATE TABLE `lauf_firmen` (
	`run_id` integer NOT NULL,
	`company_id` integer NOT NULL,
	`icp_score` integer,
	`daten_score` integer,
	`gesamt_score` integer,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lauf_firmen_eindeutig_idx` ON `lauf_firmen` (`run_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `lauf_firmen_gesamt_idx` ON `lauf_firmen` (`run_id`,`gesamt_score`);
