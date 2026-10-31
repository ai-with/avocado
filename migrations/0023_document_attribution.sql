-- 0023: 자료 열람을 클릭 당시 목적지에 연결한다. 기존 클릭의 출처는 추정해서 채우지 않는다.
ALTER TABLE `link_clicks` ADD `destination_type` text;
ALTER TABLE `link_clicks` ADD `destination_id` text;
CREATE INDEX `link_clicks_destination_idx` ON `link_clicks` (`destination_type`, `destination_id`, `at`);

ALTER TABLE `document_views` ADD `click_token` text;
-- -1은 과거 정의의 기록(실제 열림 확인 불가)과 구 Worker의 INSERT를 보존한다.
-- NULL은 신규 폼 대기, 양수는 실제 자료 화면의 첫 열림이다.
ALTER TABLE `document_views` ADD `opened_at` integer DEFAULT -1;
CREATE INDEX `document_views_click_idx` ON `document_views` (`click_token`);
CREATE INDEX `document_views_opened_idx` ON `document_views` (`document_id`, `opened_at`);
-- 과거 폼의 예약 행과 실제 열람을 구별할 기록은 없다. -1은 집계 시 started_at을 쓰며 클릭 전환율에서는 제외한다.
