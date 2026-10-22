-- 0003: 리드 도구 (채널별 단축링크, 자료 열람, 리드, 태그·그룹, 신청 폼). 0002_guides 의 guides, influencers 를 참조한다
CREATE TABLE `link_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`sort` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `link_channels_ws_key_idx` ON `link_channels` (`workspace_id`, `key`);

CREATE TABLE `short_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`guide_id` text,
	`influencer_id` text,
	`channel_key` text NOT NULL,
	`slug` text NOT NULL,
	`destination_type` text NOT NULL CHECK (`destination_type` IN ('document', 'form', 'url')),
	`destination_id` text,
	`destination_url` text,
	`utm` text NOT NULL,
	`og` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`guide_id`) REFERENCES `guides`(`id`) ON DELETE set null,
	FOREIGN KEY (`influencer_id`) REFERENCES `influencers`(`id`) ON DELETE set null
);
CREATE UNIQUE INDEX `short_links_slug_unique` ON `short_links` (`slug`);
CREATE INDEX `short_links_guide_idx` ON `short_links` (`guide_id`);
CREATE INDEX `short_links_ws_idx` ON `short_links` (`workspace_id`);

CREATE TABLE `link_clicks` (
	`id` text PRIMARY KEY NOT NULL,
	`link_id` text NOT NULL,
	`at` integer NOT NULL,
	`referrer` text,
	`device` text NOT NULL CHECK (`device` IN ('mobile', 'desktop', 'other')),
	`country` text,
	`ip_hash` text,
	`is_bot` integer NOT NULL,
	`is_member` integer NOT NULL,
	`session_id` text,
	FOREIGN KEY (`link_id`) REFERENCES `short_links`(`id`) ON DELETE cascade
);
CREATE INDEX `link_clicks_link_idx` ON `link_clicks` (`link_id`, `at`);

CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`guide_id` text,
	`title` text NOT NULL,
	`file_key` text NOT NULL,
	`pages` integer NOT NULL,
	`size_mb` real NOT NULL,
	`allow_download` integer DEFAULT false NOT NULL,
	`gate` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`guide_id`) REFERENCES `guides`(`id`) ON DELETE set null
);
CREATE INDEX `documents_ws_idx` ON `documents` (`workspace_id`);

CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`company` text,
	`phone` text,
	`answers` text NOT NULL,
	`marketing_opt_in` integer DEFAULT false NOT NULL,
	`alimtalk_opt_in` integer DEFAULT false NOT NULL,
	`unsubscribed_at` integer,
	`bounced_at` integer,
	`unsubscribe_token` text NOT NULL,
	`first_source` text NOT NULL,
	`last_source` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `leads_unsubscribe_token_unique` ON `leads` (`unsubscribe_token`);
CREATE UNIQUE INDEX `leads_ws_email_idx` ON `leads` (`workspace_id`, `email`);

CREATE TABLE `document_views` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`link_id` text,
	`session_id` text,
	`lead_id` text,
	`started_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`max_page` integer DEFAULT 0 NOT NULL,
	`max_scroll_pct` integer DEFAULT 0 NOT NULL,
	`is_member` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE cascade,
	FOREIGN KEY (`link_id`) REFERENCES `short_links`(`id`) ON DELETE set null,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE set null
);
CREATE INDEX `document_views_doc_idx` ON `document_views` (`document_id`);
CREATE INDEX `document_views_link_idx` ON `document_views` (`link_id`);
CREATE INDEX `document_views_lead_idx` ON `document_views` (`lead_id`);

CREATE TABLE `document_page_views` (
	`view_id` text NOT NULL,
	`page` integer NOT NULL,
	`dwell_ms` integer NOT NULL,
	PRIMARY KEY(`view_id`, `page`),
	FOREIGN KEY (`view_id`) REFERENCES `document_views`(`id`) ON DELETE cascade
);

CREATE TABLE `lead_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`type` text NOT NULL CHECK (`type` IN ('gate', 'form', 'keyword_dm', 'import', 'manual')),
	`guide_id` text,
	`influencer_id` text,
	`channel_key` text,
	`link_id` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE cascade,
	FOREIGN KEY (`guide_id`) REFERENCES `guides`(`id`) ON DELETE set null,
	FOREIGN KEY (`influencer_id`) REFERENCES `influencers`(`id`) ON DELETE set null,
	FOREIGN KEY (`link_id`) REFERENCES `short_links`(`id`) ON DELETE set null
);
CREATE INDEX `lead_sources_lead_idx` ON `lead_sources` (`lead_id`);
CREATE INDEX `lead_sources_link_idx` ON `lead_sources` (`link_id`);
CREATE INDEX `lead_sources_guide_idx` ON `lead_sources` (`guide_id`);

CREATE TABLE `lead_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `lead_tags_ws_name_idx` ON `lead_tags` (`workspace_id`, `name`);

CREATE TABLE `lead_tag_links` (
	`lead_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`lead_id`, `tag_id`),
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `lead_tags`(`id`) ON DELETE cascade
);

CREATE TABLE `lead_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`rules` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade
);

CREATE TABLE `forms` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`guide_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`header_image_key` text,
	`fields` text NOT NULL,
	`closes_at` integer,
	`max_submissions` integer,
	`closed_message` text DEFAULT '' NOT NULL,
	`after_submit` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`guide_id`) REFERENCES `guides`(`id`) ON DELETE set null
);
CREATE INDEX `forms_ws_idx` ON `forms` (`workspace_id`);

CREATE TABLE `form_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`form_id` text NOT NULL,
	`lead_id` text,
	`link_id` text,
	`answers` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE set null,
	FOREIGN KEY (`link_id`) REFERENCES `short_links`(`id`) ON DELETE set null
);
CREATE INDEX `form_submissions_form_idx` ON `form_submissions` (`form_id`);
CREATE INDEX `form_submissions_lead_idx` ON `form_submissions` (`lead_id`);
