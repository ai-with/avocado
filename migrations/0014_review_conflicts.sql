-- 0014: 기각 사유 메모(338), 승인 뒤 새 버전을 '기존 승인 유지'로 닫은 기록(340)
ALTER TABLE `violation_candidates` ADD `decision_note` text;

CREATE TABLE `superseded_versions` (
	`submission_id` text PRIMARY KEY NOT NULL,
	`guide_influencer_id` text NOT NULL,
	`kept_by` text,
	`kept_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade,
	FOREIGN KEY (`guide_influencer_id`) REFERENCES `guide_influencers`(`id`) ON DELETE cascade,
	FOREIGN KEY (`kept_by`) REFERENCES `users`(`id`) ON DELETE set null
);
CREATE INDEX `superseded_versions_gi_idx` ON `superseded_versions` (`guide_influencer_id`);
