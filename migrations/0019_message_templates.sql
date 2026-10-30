-- TASK-073 (AIWITH-484): 사용자 변수, 메시지 템플릿, 언어별 본문
-- 기본(시스템) 변수는 코드 상수(src/shared/message-render.ts)라 테이블에 없다. 사용자 변수 값은 참여 terms.vars[key]
-- 되돌리기: DROP TABLE message_template_bodies; DROP TABLE message_templates; DROP TABLE message_variables;
CREATE TABLE IF NOT EXISTS `message_variables` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`default_value` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS `message_variables_key_unique` ON `message_variables` (`workspace_id`, `key`);

CREATE TABLE IF NOT EXISTS `message_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`purpose` text DEFAULT 'contact' NOT NULL CHECK (`purpose` IN ('contact', 'guide', 'reminder', 'feedback', 'other')),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS `message_templates_workspace_idx` ON `message_templates` (`workspace_id`, `created_at`);

CREATE TABLE IF NOT EXISTS `message_template_bodies` (
	`template_id` text NOT NULL,
	`lang` text NOT NULL CHECK (`lang` IN ('ko', 'en')),
	`body` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY (`template_id`, `lang`),
	FOREIGN KEY (`template_id`) REFERENCES `message_templates`(`id`) ON DELETE cascade
);
