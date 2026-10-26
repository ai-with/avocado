-- 0011: 도움 받기 문의 (TASK-054, AIWITH-445). 상태는 지금 received 하나만 쓴다
CREATE TABLE `support_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`body` text NOT NULL,
	`reply_email` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
CREATE INDEX `support_requests_ws_user_idx` ON `support_requests` (`workspace_id`,`user_id`,`created_at`);
