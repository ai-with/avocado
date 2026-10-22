-- 0005: 발송 (F-66 자동 발송, F-67 1회성 발송, 발송 로그, 알림톡 채널). 0003_leads 의 leads 를 참조한다
ALTER TABLE `workspaces` ADD `sender_name` text;
ALTER TABLE `workspaces` ADD `sender_contact` text;

CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`trigger` text NOT NULL CHECK (`trigger` IN ('form_submitted', 'gate_passed', 'document_completed')),
	`target` text NOT NULL,
	`delay_minutes` integer NOT NULL CHECK (`delay_minutes` IN (0, 60, 1440, 4320)),
	`channel` text NOT NULL CHECK (`channel` IN ('email', 'alimtalk')),
	`kind` text NOT NULL CHECK (`kind` IN ('info', 'ad')),
	`template` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`last_check` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade
);
CREATE INDEX `automations_ws_trigger_idx` ON `automations` (`workspace_id`, `trigger`);

CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`ref_id` text NOT NULL,
	`due_at` integer NOT NULL,
	`status` text NOT NULL CHECK (`status` IN ('pending', 'sent', 'skipped', 'failed')),
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `automation_runs_once_idx` ON `automation_runs` (`automation_id`, `lead_id`, `ref_id`);
CREATE INDEX `automation_runs_due_idx` ON `automation_runs` (`status`, `due_at`);

CREATE TABLE `broadcasts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`channel` text NOT NULL CHECK (`channel` IN ('email', 'alimtalk')),
	`kind` text NOT NULL CHECK (`kind` IN ('info', 'ad')),
	`audience` text NOT NULL,
	`template` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL CHECK (`status` IN ('draft', 'scheduled', 'sending', 'sent')),
	`scheduled_at` integer,
	`sent_at` integer,
	`stats` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade
);
CREATE INDEX `broadcasts_ws_idx` ON `broadcasts` (`workspace_id`, `created_at`);
CREATE INDEX `broadcasts_due_idx` ON `broadcasts` (`status`, `scheduled_at`);

CREATE TABLE `message_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`lead_id` text,
	`source` text NOT NULL CHECK (`source` IN ('automation', 'broadcast', 'test')),
	`source_id` text NOT NULL,
	`channel` text NOT NULL CHECK (`channel` IN ('email', 'alimtalk')),
	`status` text NOT NULL CHECK (`status` IN ('sent', 'skipped', 'failed', 'bounced')),
	`reason` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE cascade
);
CREATE INDEX `message_logs_lead_idx` ON `message_logs` (`lead_id`, `at`);
CREATE INDEX `message_logs_source_idx` ON `message_logs` (`source_id`, `at`);

CREATE TABLE `alimtalk_channels` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'not_connected' NOT NULL CHECK (`status` IN ('not_connected', 'pending', 'connected')),
	`sender_profile_key_enc` text,
	`templates` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade
);
