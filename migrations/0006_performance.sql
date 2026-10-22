-- 0006: 성과·인스타그램 (F-48 스냅샷, F-54 계정 연결, F-64 댓글 키워드 DM). contents 는 0004_review 가 만든다
CREATE TABLE `ig_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`influencer_id` text,
	`target` text NOT NULL CHECK (`target` IN ('influencer', 'client_brand', 'brand_sender')),
	`connect_token` text,
	`label` text,
	`ig_user_id` text,
	`username` text,
	`account_type` text,
	`scopes` text NOT NULL,
	`token_enc` text,
	`expires_at` integer,
	`revoked_at` integer,
	`connected_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`influencer_id`) REFERENCES `influencers`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `ig_connections_connect_token_unique` ON `ig_connections` (`connect_token`);
CREATE INDEX `ig_connections_ws_idx` ON `ig_connections` (`workspace_id`, `target`);
CREATE INDEX `ig_connections_influencer_idx` ON `ig_connections` (`influencer_id`);
CREATE INDEX `ig_connections_ig_user_idx` ON `ig_connections` (`ig_user_id`);

CREATE TABLE `metric_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`offset_h` integer NOT NULL CHECK (`offset_h` IN (24, 72, 168)),
	`scheduled_at` integer NOT NULL,
	`captured_at` integer,
	`path` text CHECK (`path` IN ('connected', 'discovery')),
	`views` integer,
	`likes` integer,
	`saved` integer,
	`shares` integer,
	`comments` integer,
	`reach` integer,
	`reposts` integer,
	`missing` text NOT NULL,
	`delayed` integer DEFAULT false NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL CHECK (`status` IN ('scheduled', 'captured', 'missing', 'cancelled')),
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `metric_snapshots_content_offset_idx` ON `metric_snapshots` (`content_id`, `offset_h`);
CREATE INDEX `metric_snapshots_due_idx` ON `metric_snapshots` (`status`, `scheduled_at`);

CREATE TABLE `keyword_dm_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`guide_id` text,
	`ig_connection_id` text,
	`ig_media_id` text NOT NULL,
	`media_thumb_url` text,
	`media_permalink` text,
	`influencer_id` text,
	`keywords` text NOT NULL,
	`message` text NOT NULL,
	`public_reply_variants` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'off' NOT NULL CHECK (`status` IN ('on', 'off', 'paused')),
	`paused_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`guide_id`) REFERENCES `guides`(`id`) ON DELETE set null,
	FOREIGN KEY (`ig_connection_id`) REFERENCES `ig_connections`(`id`) ON DELETE set null,
	FOREIGN KEY (`influencer_id`) REFERENCES `influencers`(`id`) ON DELETE set null
);
CREATE INDEX `keyword_dm_rules_ws_idx` ON `keyword_dm_rules` (`workspace_id`);
CREATE INDEX `keyword_dm_rules_media_idx` ON `keyword_dm_rules` (`ig_media_id`);

CREATE TABLE `keyword_dm_sends` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`comment_id` text NOT NULL,
	`ig_user_id` text NOT NULL,
	`username` text,
	`comment_text` text,
	`comment_at` integer NOT NULL,
	`sent_at` integer,
	`status` text NOT NULL CHECK (`status` IN ('sent', 'already_sent', 'expired', 'failed', 'queued')),
	`reason` text,
	`link_id` text,
	FOREIGN KEY (`rule_id`) REFERENCES `keyword_dm_rules`(`id`) ON DELETE cascade,
	FOREIGN KEY (`link_id`) REFERENCES `short_links`(`id`) ON DELETE set null
);
CREATE UNIQUE INDEX `keyword_dm_sends_comment_idx` ON `keyword_dm_sends` (`rule_id`, `comment_id`);
CREATE INDEX `keyword_dm_sends_rule_user_idx` ON `keyword_dm_sends` (`rule_id`, `ig_user_id`);
CREATE INDEX `keyword_dm_sends_status_idx` ON `keyword_dm_sends` (`status`, `sent_at`);
