CREATE TABLE `instagram_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scan_id` integer NOT NULL,
	`instagram_user_id` text NOT NULL,
	`username` text NOT NULL,
	`full_name` text DEFAULT '' NOT NULL,
	`profile_pic_url` text,
	`is_private` integer DEFAULT false NOT NULL,
	`is_verified` integer DEFAULT false NOT NULL,
	`in_following` integer DEFAULT false NOT NULL,
	`in_followers` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instagram_users_scan_user_idx` ON `instagram_users` (`scan_id`,`instagram_user_id`);--> statement-breakpoint
CREATE INDEX `instagram_users_scan_idx` ON `instagram_users` (`scan_id`);--> statement-breakpoint
CREATE INDEX `instagram_users_username_idx` ON `instagram_users` (`username`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instagram_user_id` text NOT NULL,
	`username` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`captured_following` integer DEFAULT false NOT NULL,
	`captured_followers` integer DEFAULT false NOT NULL,
	`following_count` integer DEFAULT 0 NOT NULL,
	`followers_count` integer DEFAULT 0 NOT NULL,
	`reported_following_count` integer,
	`reported_followers_count` integer,
	`verified_count` integer DEFAULT 0 NOT NULL,
	`private_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `scans_instagram_user_id_idx` ON `scans` (`instagram_user_id`);--> statement-breakpoint
CREATE INDEX `scans_created_at_idx` ON `scans` (`created_at`);