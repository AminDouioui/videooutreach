ALTER TABLE `campaigns` ADD `abwesenheit_verschieben_tage` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `bounce_schutz` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `bounce_schwelle_prozent` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `bounce_fenster` integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `pausiert_grund` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `abwesend_at` integer;--> statement-breakpoint
ALTER TABLE `leads` ADD `abwesend_bis` integer;