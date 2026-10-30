-- TASK-079 (AIWITH-526): 브랜드 검수 사전. 필수 멘트, 금지어(변형어), 해시태그, 제품명 표기
-- 화장품 광고 법규 기본 금지어는 코드 상수(src/shared/cosmetic-ad-terms.ts)라 테이블에 없다. 브랜드별 사용 여부와 끈 항목만 brands 에 둔다
-- 되돌리기: DROP TABLE brand_terms; ALTER TABLE brands DROP COLUMN legal_preset_enabled; ALTER TABLE brands DROP COLUMN legal_preset_disabled; ALTER TABLE guides DROP COLUMN brand_term_exclusions;
CREATE TABLE IF NOT EXISTS `brand_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`kind` text NOT NULL CHECK (`kind` IN ('required_ment', 'forbidden', 'hashtag', 'product_name')),
	`term` text NOT NULL,
	`variants` text DEFAULT '[]' NOT NULL,
	`suggestion` text,
	`match` text DEFAULT 'exact' NOT NULL CHECK (`match` IN ('exact', 'similar')),
	`severity` text DEFAULT 'must' NOT NULL CHECK (`severity` IN ('must', 'should')),
	`targets` text DEFAULT '["speech"]' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS `brand_terms_unique` ON `brand_terms` (`brand_id`, `kind`, `term`);

ALTER TABLE `brands` ADD `legal_preset_enabled` integer DEFAULT 1 NOT NULL;
ALTER TABLE `brands` ADD `legal_preset_disabled` text DEFAULT '[]' NOT NULL;
ALTER TABLE `guides` ADD `brand_term_exclusions` text DEFAULT '[]' NOT NULL;
