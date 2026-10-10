ALTER TABLE `leads` ADD `ki_einordnung` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `ki_versuche` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `ki_versuch_at` integer;