CREATE TABLE `benutzer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`passwort_hash` text NOT NULL,
	`rolle` text DEFAULT 'mitglied' NOT NULL,
	`aktiv` integer DEFAULT true NOT NULL,
	`session_version` integer DEFAULT 0 NOT NULL,
	`letzter_login_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `benutzer_email_unique` ON `benutzer` (`email`);--> statement-breakpoint
CREATE TABLE `einladungen` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`rolle` text DEFAULT 'mitglied' NOT NULL,
	`token_hash` text NOT NULL,
	`ablauf_at` integer NOT NULL,
	`angenommen_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `einladungen_token_hash_unique` ON `einladungen` (`token_hash`);--> statement-breakpoint
CREATE INDEX `einladungen_email_idx` ON `einladungen` (`email`);