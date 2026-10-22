CREATE TABLE `raw_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quelle` text NOT NULL,
	`referenz` text NOT NULL,
	`url` text,
	`content_type` text DEFAULT 'application/json' NOT NULL,
	`inhalt` text NOT NULL,
	`inhalt_hash` text NOT NULL,
	`abgerufen_am` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_documents_version_idx` ON `raw_documents` (`quelle`,`referenz`,`inhalt_hash`);--> statement-breakpoint
CREATE INDEX `raw_documents_ref_idx` ON `raw_documents` (`quelle`,`referenz`);--> statement-breakpoint
CREATE TABLE `attribute_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer,
	`feld` text NOT NULL,
	`wert` text NOT NULL,
	`quelle` text NOT NULL,
	`raw_document_id` integer,
	`konfidenz` real DEFAULT 1 NOT NULL,
	`typ` text DEFAULT 'exakt' NOT NULL,
	`beobachtet_am` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`raw_document_id`) REFERENCES `raw_documents`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `attribute_observations_entity_idx` ON `attribute_observations` (`entity_type`,`entity_id`,`feld`);--> statement-breakpoint
CREATE INDEX `attribute_observations_raw_idx` ON `attribute_observations` (`raw_document_id`);--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filter` text NOT NULL,
	`status` text DEFAULT 'laeuft' NOT NULL,
	`gestartet_am` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`beendet_am` integer
);
--> statement-breakpoint
CREATE TABLE `pipeline_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`stufe` text NOT NULL,
	`entity_id` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'offen' NOT NULL,
	`versuche` integer DEFAULT 0 NOT NULL,
	`naechster_versuch_at` integer,
	`fehler` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_jobs_eindeutig_idx` ON `pipeline_jobs` (`run_id`,`stufe`,`entity_id`);--> statement-breakpoint
CREATE INDEX `pipeline_jobs_faellig_idx` ON `pipeline_jobs` (`status`,`naechster_versuch_at`);--> statement-breakpoint
CREATE TABLE `leadgen_kosten` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer,
	`anbieter` text NOT NULL,
	`art` text NOT NULL,
	`einheiten` integer DEFAULT 1 NOT NULL,
	`kosten_milli_cent` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `leadgen_kosten_run_idx` ON `leadgen_kosten` (`run_id`);
