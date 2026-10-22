CREATE TABLE `email_verifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`adresse` text NOT NULL,
	`domain` text NOT NULL,
	`status` text NOT NULL,
	`details` text,
	`verifier` text NOT NULL,
	`geprueft_am` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_verifications_adresse_idx` ON `email_verifications` (`adresse`);--> statement-breakpoint
CREATE INDEX `email_verifications_domain_idx` ON `email_verifications` (`domain`);--> statement-breakpoint
CREATE TABLE `domain_email_patterns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`muster` text NOT NULL,
	`belege` real DEFAULT 0 NOT NULL,
	`aktualisiert_am` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_email_patterns_idx` ON `domain_email_patterns` (`domain`,`muster`);--> statement-breakpoint
CREATE TABLE `domain_mail_status` (
	`domain` text PRIMARY KEY NOT NULL,
	`mx` text NOT NULL,
	`catch_all` integer,
	`geprueft_am` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contact_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`person_id` integer,
	`typ` text NOT NULL,
	`wert` text NOT NULL,
	`status` text NOT NULL,
	`art` text,
	`rolle_key` text,
	`muster` text,
	`konfidenz` real DEFAULT 0 NOT NULL,
	`herkunft` text,
	`verifiziert_am` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_points_eindeutig_idx` ON `contact_points` (`company_id`,`typ`,`wert`);--> statement-breakpoint
CREATE INDEX `contact_points_person_idx` ON `contact_points` (`person_id`);--> statement-breakpoint
CREATE TABLE `kontakt_ergebnisse` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`rolle_key` text NOT NULL,
	`status` text NOT NULL,
	`person_id` integer,
	`contact_point_id` integer,
	`rollen_treffer` text,
	`konfidenz` real DEFAULT 0 NOT NULL,
	`details` text,
	`versuche` integer DEFAULT 0 NOT NULL,
	`naechste_anreicherung_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_point_id`) REFERENCES `contact_points`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kontakt_ergebnisse_eindeutig_idx` ON `kontakt_ergebnisse` (`company_id`,`rolle_key`);--> statement-breakpoint
CREATE INDEX `kontakt_ergebnisse_faellig_idx` ON `kontakt_ergebnisse` (`status`,`naechste_anreicherung_at`);
