CREATE TABLE `register_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quelle` text NOT NULL,
	`referenz` text NOT NULL,
	`company_id` integer,
	`typ` text NOT NULL,
	`daten` text NOT NULL,
	`schluessel` text NOT NULL,
	`status` text DEFAULT 'neu' NOT NULL,
	`erkannt_am` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`bearbeitet_am` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `register_events_schluessel_idx` ON `register_events` (`schluessel`);--> statement-breakpoint
CREATE INDEX `register_events_status_idx` ON `register_events` (`status`,`erkannt_am`);--> statement-breakpoint
CREATE INDEX `register_events_company_idx` ON `register_events` (`company_id`);
