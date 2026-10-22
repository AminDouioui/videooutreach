CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`rechtsform` text,
	`name_normalized` text NOT NULL,
	`register_key` text,
	`strasse` text,
	`plz` text,
	`ort` text,
	`bundesland` text,
	`domain` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_register_key_idx` ON `companies` (`register_key`);--> statement-breakpoint
CREATE INDEX `companies_plz_idx` ON `companies` (`plz`);--> statement-breakpoint
CREATE TABLE `persons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`vorname` text,
	`nachname` text NOT NULL,
	`name_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `persons_company_idx` ON `persons` (`company_id`);--> statement-breakpoint
CREATE TABLE `company_blocks` (
	`company_id` integer NOT NULL,
	`schluessel` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_blocks_eindeutig_idx` ON `company_blocks` (`company_id`,`schluessel`);--> statement-breakpoint
CREATE INDEX `company_blocks_schluessel_idx` ON `company_blocks` (`schluessel`);--> statement-breakpoint
CREATE TABLE `entity_map` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quelle` text NOT NULL,
	`referenz` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`match_score` real DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'neu' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_map_quelle_idx` ON `entity_map` (`quelle`,`referenz`,`entity_type`);--> statement-breakpoint
CREATE INDEX `entity_map_entity_idx` ON `entity_map` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `match_review` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`kandidat_id` integer NOT NULL,
	`score` real NOT NULL,
	`details` text NOT NULL,
	`status` text DEFAULT 'offen' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_review_paar_idx` ON `match_review` (`company_id`,`kandidat_id`);--> statement-breakpoint
CREATE INDEX `match_review_status_idx` ON `match_review` (`status`);
