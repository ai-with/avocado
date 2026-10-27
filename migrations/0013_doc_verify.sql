-- TASK-057: 자료 게이트 이메일 인증 (AIWITH-352). 메일 링크의 1회용 토큰은 SHA-256 해시만 저장한다
CREATE TABLE `doc_verify_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`view_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`view_id`) REFERENCES `document_views`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `doc_verify_tokens_view_idx` ON `doc_verify_tokens` (`view_id`,`created_at`);
