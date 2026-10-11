ALTER TABLE `campaigns` ADD `zeitzone` text DEFAULT 'Europe/Berlin' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `zeitzone` text;