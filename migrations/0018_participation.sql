-- TASK-072 (AIWITH-489·490~492): 인플루언서별 진행 상태·조건, 소통 이력
-- status: 'contact'|'progress'|'review'|'done'|'stopped'. 기존 행은 stage 에서 채운다(src/shared/participation.ts statusFromStage 와 같은 규칙)
-- terms: 조건 JSON { amount, currency, deliverables, memo, vars? }
-- 되돌리기: DROP TABLE contact_logs; ALTER TABLE guide_influencers DROP COLUMN terms; ALTER TABLE guide_influencers DROP COLUMN status;
ALTER TABLE `guide_influencers` ADD `status` text DEFAULT 'contact' NOT NULL;
ALTER TABLE `guide_influencers` ADD `terms` text;

UPDATE `guide_influencers` SET `status` = CASE `stage`
	WHEN 'consented' THEN 'progress'
	WHEN 'uploaded' THEN 'review'
	WHEN 'feedback_sent' THEN 'review'
	WHEN 'approved' THEN 'done'
	WHEN 'withdrawn' THEN 'stopped'
	ELSE 'contact'
END;

CREATE TABLE IF NOT EXISTS `contact_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`guide_influencer_id` text NOT NULL,
	`kind` text NOT NULL CHECK (`kind` IN ('message', 'status', 'note', 'system')),
	`channel` text CHECK (`channel` IS NULL OR `channel` IN ('dm', 'email')),
	`lang` text,
	`body` text NOT NULL,
	`meta` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`guide_influencer_id`) REFERENCES `guide_influencers`(`id`) ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null
);
CREATE INDEX IF NOT EXISTS `contact_logs_gi_idx` ON `contact_logs` (`guide_influencer_id`, `created_at`);
