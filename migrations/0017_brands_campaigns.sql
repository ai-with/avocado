-- TASK-070 (AIWITH-494): 워크스페이스 안에 브랜드 여럿, 브랜드마다 캠페인, 캠페인과 브랜드 가이드는 1:1
-- 이관: 워크스페이스마다 이름이 같은 기본 브랜드 1개, 가이드마다 캠페인 1개(캠페인 id = 가이드 id, 이름 = 가이드 이름)
-- 데이터 문장은 이미 있으면 건너뛴다. ALTER 는 wrangler 가 한 번만 돌린다
-- guides.campaign_id 에는 FK 를 두지 않는다(앱이 관리). FK 가 있으면 SQLite 가 DROP COLUMN 을 막아 되돌리기가 어려워진다
-- 되돌리기: DROP INDEX guides_campaign_unique; ALTER TABLE guides DROP COLUMN campaign_id; DROP TABLE campaigns; DROP TABLE brands;
CREATE TABLE IF NOT EXISTS `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`logo_url` text,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS `brands_workspace_idx` ON `brands` (`workspace_id`, `created_at`);

CREATE TABLE IF NOT EXISTS `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active', 'archived')),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`)
);
CREATE INDEX IF NOT EXISTS `campaigns_workspace_idx` ON `campaigns` (`workspace_id`, `created_at`);
CREATE INDEX IF NOT EXISTS `campaigns_brand_idx` ON `campaigns` (`brand_id`);

ALTER TABLE `guides` ADD `campaign_id` text;

INSERT INTO `brands` (`id`, `workspace_id`, `name`, `created_at`)
SELECT lower(hex(randomblob(16))), w.`id`, w.`name`, w.`created_at` FROM `workspaces` w
WHERE NOT EXISTS (SELECT 1 FROM `brands` b WHERE b.`workspace_id` = w.`id`);

INSERT INTO `campaigns` (`id`, `workspace_id`, `brand_id`, `name`, `status`, `created_at`, `updated_at`)
SELECT g.`id`, g.`workspace_id`,
	(SELECT b.`id` FROM `brands` b WHERE b.`workspace_id` = g.`workspace_id` AND b.`deleted_at` IS NULL ORDER BY b.`created_at`, b.`id` LIMIT 1),
	g.`name`, 'active', g.`created_at`, g.`updated_at`
FROM `guides` g
WHERE g.`campaign_id` IS NULL AND NOT EXISTS (SELECT 1 FROM `campaigns` c WHERE c.`id` = g.`id`);

UPDATE `guides` SET `campaign_id` = `id` WHERE `campaign_id` IS NULL AND EXISTS (SELECT 1 FROM `campaigns` c WHERE c.`id` = `guides`.`id`);

CREATE UNIQUE INDEX IF NOT EXISTS `guides_campaign_unique` ON `guides` (`campaign_id`);
