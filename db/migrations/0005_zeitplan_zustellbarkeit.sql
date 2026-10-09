ALTER TABLE `campaigns` ADD `send_days` text DEFAULT '1,2,3,4,5' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `start_datum` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `max_neue_leads_pro_tag` integer;--> statement-breakpoint
UPDATE `campaigns` SET `send_days` = CASE WHEN `send_weekdays_only` = 1 THEN '1,2,3,4,5' ELSE '1,2,3,4,5,6,7' END;
