-- TASK-029: 웹 SDK 수집 (docs/14 6-5). 사이트 등록, 세션 요약, 전환, 사이트 사람, 일별 집계
-- 원본 이벤트는 Analytics Engine 에만 두고 D1 에는 요약만 쌓는다
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`site_key` text NOT NULL,
	`name` text NOT NULL,
	`allowed_domains` text NOT NULL,
	`currency` text DEFAULT 'KRW' NOT NULL,
	`attribution_days` integer DEFAULT 30 NOT NULL,
	`consent_mode` text DEFAULT 'auto' NOT NULL CHECK (`consent_mode` IN ('auto', 'require')),
	`collect_raw_email` integer DEFAULT false NOT NULL,
	`first_event_at` integer,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `sites_site_key_unique` ON `sites` (`site_key`);
CREATE INDEX `sites_ws_idx` ON `sites` (`workspace_id`);

-- id 는 SDK 가 만든 session_id 라 사이트끼리 겹칠 수 있어 (site_id, id) 로 묶는다
CREATE TABLE `site_sessions` (
	`site_id` text NOT NULL,
	`id` text NOT NULL,
	`anon_id` text NOT NULL,
	`person_id` text,
	`link_id` text,
	`click_token` text,
	`match` text DEFAULT 'none' NOT NULL CHECK (`match` IN ('click', 'utm', 'none')),
	`first_at` integer NOT NULL,
	`last_at` integer NOT NULL,
	`pageviews` integer DEFAULT 0 NOT NULL,
	`max_scroll` integer DEFAULT 0 NOT NULL,
	`visible_ms` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`is_member` integer DEFAULT false NOT NULL,
	`country` text,
	`device` text,
	PRIMARY KEY(`site_id`, `id`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE cascade,
	FOREIGN KEY (`link_id`) REFERENCES `short_links`(`id`) ON DELETE set null
);
CREATE INDEX `site_sessions_first_idx` ON `site_sessions` (`site_id`, `first_at`);
CREATE INDEX `site_sessions_link_idx` ON `site_sessions` (`link_id`);
CREATE INDEX `site_sessions_anon_idx` ON `site_sessions` (`site_id`, `anon_id`);

CREATE TABLE `site_conversions` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`session_id` text NOT NULL,
	`person_id` text,
	`link_id` text,
	`kind` text NOT NULL CHECK (`kind` IN ('purchase', 'signup', 'apply', 'custom')),
	`name` text,
	`value` real,
	`currency` text NOT NULL,
	`order_id` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE cascade,
	FOREIGN KEY (`link_id`) REFERENCES `short_links`(`id`) ON DELETE set null
);
-- order_id 가 NULL 인 전환은 SQLite 유일 제약에서 서로 다른 값으로 본다
CREATE UNIQUE INDEX `site_conversions_order_idx` ON `site_conversions` (`site_id`, `order_id`);
CREATE INDEX `site_conversions_session_idx` ON `site_conversions` (`site_id`, `session_id`);
CREATE INDEX `site_conversions_link_idx` ON `site_conversions` (`link_id`);

CREATE TABLE `site_people` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`anon_ids` text NOT NULL,
	`external_id` text,
	`email_hash` text,
	`lead_id` text,
	`first_link_id` text,
	`last_link_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE set null,
	FOREIGN KEY (`first_link_id`) REFERENCES `short_links`(`id`) ON DELETE set null,
	FOREIGN KEY (`last_link_id`) REFERENCES `short_links`(`id`) ON DELETE set null
);
CREATE INDEX `site_people_hash_idx` ON `site_people` (`site_id`, `email_hash`);
CREATE INDEX `site_people_ext_idx` ON `site_people` (`site_id`, `external_id`);

-- link_id 가 없는 방문은 '' 로 둔다(PK 에 NULL 을 넣지 않기 위해)
CREATE TABLE `site_daily_stats` (
	`site_id` text NOT NULL,
	`day` text NOT NULL,
	`link_id` text DEFAULT '' NOT NULL,
	`sessions` integer DEFAULT 0 NOT NULL,
	`pageviews` integer DEFAULT 0 NOT NULL,
	`scroll_25` integer DEFAULT 0 NOT NULL,
	`scroll_50` integer DEFAULT 0 NOT NULL,
	`scroll_75` integer DEFAULT 0 NOT NULL,
	`scroll_100` integer DEFAULT 0 NOT NULL,
	`conversions` integer DEFAULT 0 NOT NULL,
	`conversion_value` real DEFAULT 0 NOT NULL,
	`members_excluded` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`site_id`, `day`, `link_id`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE cascade
);

-- 이벤트 ID 중복 제거(24시간). 하루 지난 행은 cron 이 지운다
CREATE TABLE `site_event_ids` (
	`site_id` text NOT NULL,
	`id` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`site_id`, `id`)
);
CREATE INDEX `site_event_ids_at_idx` ON `site_event_ids` (`at`);

-- 클릭 ID(avc). 내부 PK 대신 밖에 내보내는 짧은 토큰
ALTER TABLE `link_clicks` ADD `click_token` text;
CREATE UNIQUE INDEX `link_clicks_click_token_idx` ON `link_clicks` (`click_token`);

-- 사이트 identify 해시 매칭용. 소문자·공백 제거 이메일의 SHA-256 hex
ALTER TABLE `leads` ADD `email_hash` text;
CREATE INDEX `leads_ws_email_hash_idx` ON `leads` (`workspace_id`, `email_hash`);

-- lead_sources.type 에 'site' 추가. SQLite 는 CHECK 를 바꿀 수 없어 표를 다시 만든다
PRAGMA defer_foreign_keys = true;
CREATE TABLE `lead_sources_new` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`type` text NOT NULL CHECK (`type` IN ('gate', 'form', 'keyword_dm', 'import', 'manual', 'site')),
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
INSERT INTO `lead_sources_new` SELECT `id`, `lead_id`, `type`, `guide_id`, `influencer_id`, `channel_key`, `link_id`, `at` FROM `lead_sources`;
DROP TABLE `lead_sources`;
ALTER TABLE `lead_sources_new` RENAME TO `lead_sources`;
CREATE INDEX `lead_sources_lead_idx` ON `lead_sources` (`lead_id`);
CREATE INDEX `lead_sources_link_idx` ON `lead_sources` (`link_id`);
CREATE INDEX `lead_sources_guide_idx` ON `lead_sources` (`guide_id`);
