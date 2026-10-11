ALTER TABLE `absender` ADD `typ` text DEFAULT 'gmail' NOT NULL;--> statement-breakpoint
ALTER TABLE `absender` ADD `smtp_host` text;--> statement-breakpoint
ALTER TABLE `absender` ADD `smtp_port` integer;--> statement-breakpoint
ALTER TABLE `absender` ADD `smtp_sicherheit` text;--> statement-breakpoint
ALTER TABLE `absender` ADD `smtp_benutzer` text;--> statement-breakpoint
ALTER TABLE `absender` ADD `imap_host` text;--> statement-breakpoint
ALTER TABLE `absender` ADD `imap_port` integer;--> statement-breakpoint
ALTER TABLE `absender` ADD `imap_sicherheit` text;--> statement-breakpoint
ALTER TABLE `absender` ADD `imap_benutzer` text;--> statement-breakpoint
ALTER TABLE `absender` ADD `zugangsdaten_enc` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `absender` ADD `imap_kopie_gesendet` integer DEFAULT true NOT NULL;