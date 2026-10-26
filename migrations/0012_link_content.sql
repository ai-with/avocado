-- TASK-056: 콘텐츠별 리드 링크 (AIWITH-447). content_key 가 NULL 이면 칸의 기본 링크, 값이 있으면(c2, c3 ...) 같은 칸에 덧붙인 콘텐츠 링크
ALTER TABLE `short_links` ADD `content_key` text;
ALTER TABLE `short_links` ADD `content_label` text;
-- 같은 가이드·인플루언서·채널에 살아 있는 기본 링크는 하나, 콘텐츠 링크는 키마다 하나
CREATE UNIQUE INDEX `short_links_base_cell_idx` ON `short_links` (`guide_id`, `influencer_id`, `channel_key`) WHERE `content_key` IS NULL AND `deleted_at` IS NULL;
CREATE UNIQUE INDEX `short_links_content_cell_idx` ON `short_links` (`guide_id`, `influencer_id`, `channel_key`, `content_key`) WHERE `content_key` IS NOT NULL AND `deleted_at` IS NULL;
