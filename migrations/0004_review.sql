-- 0004: 처리 파이프라인(F-60), 위반 후보(F-61), 피드백·승인(F-62), 게시물 URL(F-48 contents)
CREATE TABLE `processing_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`stage` text NOT NULL CHECK (`stage` IN ('transcribe', 'translate', 'detect', 'notify')),
	`status` text NOT NULL CHECK (`status` IN ('queued', 'running', 'done', 'failed', 'skipped')),
	`attempts` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`error` text,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `processing_jobs_stage_idx` ON `processing_jobs` (`submission_id`, `stage`);

CREATE TABLE `transcript_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`lang` text NOT NULL,
	`text` text NOT NULL,
	`translated_text` text,
	`translated_lang` text,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade
);
CREATE INDEX `transcript_segments_sub_idx` ON `transcript_segments` (`submission_id`, `start_ms`);

CREATE TABLE `violation_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`rule_type` text NOT NULL,
	`rule_content` text NOT NULL,
	`rule_version` integer,
	`result` text NOT NULL CHECK (`result` IN ('candidate', 'needs_check', 'compliant', 'undetermined')),
	`confidence` text NOT NULL CHECK (`confidence` IN ('high', 'medium', 'low')),
	`frame_ids` text NOT NULL,
	`segment_ids` text NOT NULL,
	`reason` text NOT NULL,
	`model_version` text NOT NULL,
	`prompt_version` text NOT NULL,
	`decision` text CHECK (`decision` IN ('adopted', 'rejected', 'held')),
	`decision_reason` text CHECK (`decision_reason` IN ('compliant', 'irrelevant', 'ambiguous', 'other')),
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON DELETE set null
);
CREATE INDEX `violation_candidates_sub_idx` ON `violation_candidates` (`submission_id`);

CREATE TABLE `review_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`guide_influencer_id` text NOT NULL,
	`n` integer NOT NULL,
	`submitted_at` integer NOT NULL,
	`submitted_by` text,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade,
	FOREIGN KEY (`guide_influencer_id`) REFERENCES `guide_influencers`(`id`) ON DELETE cascade,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON DELETE set null
);
CREATE INDEX `review_rounds_gi_idx` ON `review_rounds` (`guide_influencer_id`, `n`);
CREATE INDEX `review_rounds_sub_idx` ON `review_rounds` (`submission_id`);

CREATE TABLE `feedback_items` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`round_id` text,
	`n` integer,
	`frame_id` text,
	`t_ms` integer NOT NULL,
	`shape` text,
	`text` text NOT NULL,
	`text_translated` text,
	`source` text NOT NULL CHECK (`source` IN ('candidate', 'manual', 'missed')),
	`candidate_id` text,
	`rule_id` text,
	`author_id` text,
	`influencer_done` integer DEFAULT 0 NOT NULL,
	`reply` text,
	`reply_translated` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `review_rounds`(`id`) ON DELETE cascade,
	FOREIGN KEY (`frame_id`) REFERENCES `frames`(`id`) ON DELETE set null,
	FOREIGN KEY (`candidate_id`) REFERENCES `violation_candidates`(`id`) ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE set null
);
CREATE INDEX `feedback_items_sub_idx` ON `feedback_items` (`submission_id`);
CREATE INDEX `feedback_items_round_idx` ON `feedback_items` (`round_id`);

CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`guide_influencer_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`approved_by` text,
	`approved_at` integer NOT NULL,
	FOREIGN KEY (`guide_influencer_id`) REFERENCES `guide_influencers`(`id`) ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE set null
);
CREATE UNIQUE INDEX `approvals_guide_influencer_id_unique` ON `approvals` (`guide_influencer_id`);

CREATE TABLE `contents` (
	`id` text PRIMARY KEY NOT NULL,
	`guide_id` text NOT NULL,
	`influencer_id` text NOT NULL,
	`guide_influencer_id` text NOT NULL,
	`url` text NOT NULL,
	`ig_media_id` text,
	`format` text NOT NULL CHECK (`format` IN ('reel', 'feed', 'carousel', 'story', 'unknown')),
	`posted_at` integer,
	`posted_at_source` text CHECK (`posted_at_source` IN ('api', 'manual')),
	`url_submitted_by` text NOT NULL CHECK (`url_submitted_by` IN ('influencer', 'brand')),
	`registered_at` integer NOT NULL,
	`conflict_url` text,
	`deleted_at` integer,
	FOREIGN KEY (`guide_id`) REFERENCES `guides`(`id`) ON DELETE cascade,
	FOREIGN KEY (`influencer_id`) REFERENCES `influencers`(`id`) ON DELETE cascade,
	FOREIGN KEY (`guide_influencer_id`) REFERENCES `guide_influencers`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `contents_guide_influencer_id_unique` ON `contents` (`guide_influencer_id`);
CREATE INDEX `contents_guide_idx` ON `contents` (`guide_id`);
