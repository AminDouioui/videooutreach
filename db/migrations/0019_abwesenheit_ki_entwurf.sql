ALTER TABLE `leads` ADD `abwesend_ki_at` integer;--> statement-breakpoint
ALTER TABLE `leads` ADD `abwesend_ki_versuche` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `ki_entwurf` text;