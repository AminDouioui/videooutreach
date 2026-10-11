CREATE TABLE `untersequenzen` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer NOT NULL,
	`ausloeser_status` text NOT NULL,
	`ziel_campaign_id` integer NOT NULL,
	`aktiv` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ziel_campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `untersequenzen_campaign_idx` ON `untersequenzen` (`campaign_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `untersequenzen_regel_idx` ON `untersequenzen` (`campaign_id`,`ausloeser_status`,`ziel_campaign_id`);--> statement-breakpoint
ALTER TABLE `leads` ADD `deal_wert` integer;--> statement-breakpoint
ALTER TABLE `leads` ADD `deal_notiz` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `herkunft_lead_id` integer REFERENCES leads(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `leads_herkunft_idx` ON `leads` (`herkunft_lead_id`);