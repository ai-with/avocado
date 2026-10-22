-- TASK-025: 리드 수집 자료 원본 3종 (직접 쓰기, PDF, 홈페이지 주소)
-- 게이트 json 의 position before/after_page 는 서버가 읽을 때 normalizeGate()로 scroll 비율로 바꾸고, 저장할 때 새 형식으로 쓴다
ALTER TABLE `documents` ADD `source_type` text DEFAULT 'pdf' NOT NULL CHECK (`source_type` IN ('editor', 'pdf', 'url'));
ALTER TABLE `documents` ADD `content_json` text;
ALTER TABLE `documents` ADD `content_html` text;
ALTER TABLE `documents` ADD `source_url` text;
ALTER TABLE `documents` ADD `fetched_html_key` text;
ALTER TABLE `documents` ADD `fetched_at` integer;
