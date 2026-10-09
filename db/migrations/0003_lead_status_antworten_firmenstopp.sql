ALTER TABLE `campaigns` ADD `stopp_bei_firmen_antwort` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `antwort_at` integer;--> statement-breakpoint
ALTER TABLE `leads` ADD `antwort_gelesen` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `lead_status` text DEFAULT 'offen' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `lead_status_at` integer;--> statement-breakpoint
CREATE INDEX `leads_flow_stopp_idx` ON `leads` (`flow_stopp`);--> statement-breakpoint
UPDATE `leads` SET `antwort_at` = `flow_stopp_at` WHERE `flow_stopp` = 'beantwortet';
