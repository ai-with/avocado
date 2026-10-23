-- TASK-034: 온보딩 설문 (docs/15 3장). onboarding 은 설문 JSON(건너뛰면 NULL), onboarded_at 은 완료·건너뛴 시각
ALTER TABLE `workspaces` ADD `onboarding` text;
ALTER TABLE `workspaces` ADD `onboarded_at` integer;
-- 이미 쓰던 워크스페이스에는 설문을 다시 묻지 않는다
UPDATE `workspaces` SET `onboarded_at` = `created_at`;
