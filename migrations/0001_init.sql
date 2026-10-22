-- 0001: 계정, 워크스페이스, 팀, 이벤트. 시각은 모두 epoch ms 정수
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);

CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`plan` text DEFAULT 'starter' NOT NULL,
	`created_at` integer NOT NULL
);

CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`current_workspace_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);

CREATE TABLE `members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL CHECK (`role` IN ('owner', 'editor', 'approver', 'viewer')),
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
CREATE INDEX `members_user_idx` ON `members` (`user_id`);

CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL CHECK (`role` IN ('editor', 'approver', 'viewer')),
	`token` text NOT NULL,
	`invited_by` text,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE set null
);
CREATE UNIQUE INDEX `invites_token_unique` ON `invites` (`token`);
CREATE INDEX `invites_workspace_idx` ON `invites` (`workspace_id`);

CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`name` text NOT NULL,
	`props` text NOT NULL,
	`at` integer NOT NULL
);
CREATE INDEX `events_workspace_name_idx` ON `events` (`workspace_id`, `name`, `at`);
