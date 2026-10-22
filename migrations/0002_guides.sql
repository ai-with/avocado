-- 0002: 규정 세트, 가이드, 인플루언서, 동의, 열람, 업로드(제출물·파트·프레임·오디오)
CREATE TABLE `guideline_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade
);
CREATE INDEX `guideline_sets_workspace_idx` ON `guideline_sets` (`workspace_id`);

CREATE TABLE `guideline_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`set_id` text NOT NULL,
	`type` text NOT NULL CHECK (`type` IN ('required_phrase', 'forbidden_phrase', 'required_scene', 'forbidden_scene', 'ad_disclosure', 'format', 'language')),
	`content` text NOT NULL,
	`severity` text NOT NULL CHECK (`severity` IN ('must', 'should')),
	`targets` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `guideline_sets`(`id`) ON DELETE cascade
);
CREATE INDEX `guideline_rules_set_idx` ON `guideline_rules` (`set_id`);

CREATE TABLE `guides` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`guideline_set_id` text,
	`extra_rules` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL CHECK (`status` IN ('draft', 'published')),
	`product` text NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`length_s` integer,
	`lang` text DEFAULT 'ko' NOT NULL,
	`deadline_at` integer,
	`deliverables` text NOT NULL,
	`secondary_use_scope` text NOT NULL,
	`video_guide` text,
	`generated_by_model` text,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`guideline_set_id`) REFERENCES `guideline_sets`(`id`) ON DELETE set null
);
CREATE UNIQUE INDEX `guides_slug_unique` ON `guides` (`slug`);
CREATE INDEX `guides_workspace_idx` ON `guides` (`workspace_id`, `created_at`);

CREATE TABLE `influencers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`display_name` text NOT NULL,
	`ig_handle` text,
	`threads_handle` text,
	`email` text,
	`lang` text DEFAULT 'ko' NOT NULL,
	`country` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade
);
CREATE INDEX `influencers_workspace_idx` ON `influencers` (`workspace_id`);

CREATE TABLE `guide_influencers` (
	`id` text PRIMARY KEY NOT NULL,
	`guide_id` text NOT NULL,
	`influencer_id` text NOT NULL,
	`guide_token` text NOT NULL,
	`upload_token` text NOT NULL,
	`feedback_token` text NOT NULL,
	`connect_token` text NOT NULL,
	`stage` text DEFAULT 'invited' NOT NULL,
	`token_expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`guide_id`) REFERENCES `guides`(`id`) ON DELETE cascade,
	FOREIGN KEY (`influencer_id`) REFERENCES `influencers`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `guide_influencers_guide_token_unique` ON `guide_influencers` (`guide_token`);
CREATE UNIQUE INDEX `guide_influencers_upload_token_unique` ON `guide_influencers` (`upload_token`);
CREATE UNIQUE INDEX `guide_influencers_feedback_token_unique` ON `guide_influencers` (`feedback_token`);
CREATE UNIQUE INDEX `guide_influencers_connect_token_unique` ON `guide_influencers` (`connect_token`);
CREATE UNIQUE INDEX `guide_influencers_pair_idx` ON `guide_influencers` (`guide_id`, `influencer_id`);
CREATE INDEX `guide_influencers_influencer_idx` ON `guide_influencers` (`influencer_id`);

CREATE TABLE `consents` (
	`id` text PRIMARY KEY NOT NULL,
	`guide_influencer_id` text NOT NULL,
	`doc_version` text NOT NULL,
	`items` text NOT NULL,
	`secondary_use_scope` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`country` text NOT NULL,
	`age_confirmed` integer NOT NULL,
	`ip` text,
	`agreed_at` integer NOT NULL,
	`withdrawn_at` integer,
	FOREIGN KEY (`guide_influencer_id`) REFERENCES `guide_influencers`(`id`) ON DELETE cascade
);
CREATE INDEX `consents_gi_idx` ON `consents` (`guide_influencer_id`);

CREATE TABLE `guide_views` (
	`id` text PRIMARY KEY NOT NULL,
	`guide_influencer_id` text NOT NULL,
	`opened_at` integer NOT NULL,
	`lang` text NOT NULL,
	`first_open` integer NOT NULL,
	FOREIGN KEY (`guide_influencer_id`) REFERENCES `guide_influencers`(`id`) ON DELETE cascade
);
CREATE INDEX `guide_views_gi_idx` ON `guide_views` (`guide_influencer_id`, `opened_at`);

CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`guide_influencer_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL CHECK (`kind` IN ('final', 'clean')),
	`file_name` text,
	`size_bytes` integer,
	`original_key` text,
	`duration_s` real,
	`size_mb` real,
	`width` integer,
	`height` integer,
	`status` text NOT NULL CHECK (`status` IN ('uploading', 'uploaded', 'uploaded_external', 'processing', 'ready', 'failed', 'aborted')),
	`drive_url` text,
	`note` text,
	`upload_id` text,
	`created_at` integer NOT NULL,
	`uploaded_at` integer,
	FOREIGN KEY (`guide_influencer_id`) REFERENCES `guide_influencers`(`id`) ON DELETE cascade
);
CREATE INDEX `submissions_gi_idx` ON `submissions` (`guide_influencer_id`, `version`);
CREATE INDEX `submissions_status_idx` ON `submissions` (`status`, `created_at`);

CREATE TABLE `upload_parts` (
	`submission_id` text NOT NULL,
	`part_number` integer NOT NULL,
	`etag` text NOT NULL,
	`size` integer NOT NULL,
	PRIMARY KEY(`submission_id`, `part_number`),
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade
);

CREATE TABLE `frames` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`t_ms` integer NOT NULL,
	`image_key` text NOT NULL,
	`source` text NOT NULL CHECK (`source` IN ('fps', 'scene')),
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `frames_submission_t_idx` ON `frames` (`submission_id`, `t_ms`);

CREATE TABLE `audio_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`key` text NOT NULL,
	`sample_rate` integer NOT NULL,
	`duration_s` real NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `audio_tracks_submission_id_unique` ON `audio_tracks` (`submission_id`);
