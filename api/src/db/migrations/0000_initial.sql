CREATE TABLE `agency_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`dao_account_id` text NOT NULL,
	`nearn_account_id` text,
	`name` text DEFAULT 'MultiAgency' NOT NULL,
	`headline` text DEFAULT 'Always building. Always open.',
	`tagline` text DEFAULT 'Join our agency. Hire us. Launch your own.',
	`contact_email` text,
	`website_url` text,
	`docs_url` text,
	`description` text,
	`metadata` text,
	`admin_role_name` text DEFAULT 'Admin',
	`approver_role_name` text DEFAULT 'Approver',
	`requestor_role_name` text DEFAULT 'Requestor',
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`token_id` text NOT NULL,
	`amount` text NOT NULL,
	`note` text,
	`actor_account_id` text NOT NULL,
	`related_allocation_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `allocations_cursor` ON `allocations` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`near_account_id` text,
	`message` text,
	`metadata` text,
	`status` text DEFAULT 'new' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `applications_cursor` ON `applications` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `billings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`contributor_id` text,
	`token_id` text NOT NULL,
	`amount` text NOT NULL,
	`proposal_id` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contributor_id`) REFERENCES `contributors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `billings_cursor` ON `billings` (`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billings_proposal_unique` ON `billings` (`proposal_id`);--> statement-breakpoint
CREATE TABLE `contributors` (
	`id` text PRIMARY KEY NOT NULL,
	`near_account_id` text,
	`name` text NOT NULL,
	`email` text,
	`onboarding_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_contributors` (
	`project_id` text NOT NULL,
	`contributor_id` text NOT NULL,
	`role` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`project_id`, `contributor_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contributor_id`) REFERENCES `contributors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`nearn_listing_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_owner_slug` ON `projects` (`owner_id`,`slug`);