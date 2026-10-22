ALTER TABLE `attribute_observations` ADD `extraktion_run_id` integer;--> statement-breakpoint
CREATE TABLE `domains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`domain` text NOT NULL,
	`start_url` text,
	`verifiziert` integer DEFAULT false NOT NULL,
	`beleg` text,
	`methode` text DEFAULT 'suche' NOT NULL,
	`konfidenz` real DEFAULT 0 NOT NULL,
	`geprueft_am` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_company_domain_idx` ON `domains` (`company_id`,`domain`);--> statement-breakpoint
CREATE INDEX `domains_domain_idx` ON `domains` (`domain`);--> statement-breakpoint
CREATE TABLE `crawl_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`url` text NOT NULL,
	`art` text NOT NULL,
	`raw_document_id` integer,
	`status` text NOT NULL,
	`fehler` text,
	`abgerufen_am` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`raw_document_id`) REFERENCES `raw_documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crawl_pages_company_url_idx` ON `crawl_pages` (`company_id`,`url`);--> statement-breakpoint
CREATE TABLE `extraction_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`provider` text NOT NULL,
	`modell` text,
	`seiten` integer DEFAULT 0 NOT NULL,
	`verworfen` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `extraction_runs_company_idx` ON `extraction_runs` (`company_id`);
