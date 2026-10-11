CREATE TABLE `api_schluessel` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`praefix` text NOT NULL,
	`hash` text NOT NULL,
	`rechte` text DEFAULT 'lesen' NOT NULL,
	`letzte_nutzung_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`widerrufen_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_schluessel_hash_unique` ON `api_schluessel` (`hash`);--> statement-breakpoint
CREATE TABLE `webhook_zustellungen` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`webhook_id` integer NOT NULL,
	`ereignis` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'offen' NOT NULL,
	`versuche` integer DEFAULT 0 NOT NULL,
	`naechster_versuch_at` integer,
	`letzter_fehler` text,
	`http_status` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`zugestellt_at` integer,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_zustellungen_webhook_idx` ON `webhook_zustellungen` (`webhook_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_zustellungen_faellig_idx` ON `webhook_zustellungen` (`status`,`naechster_versuch_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`ereignisse` text NOT NULL,
	`geheimnis` text NOT NULL,
	`aktiv` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
