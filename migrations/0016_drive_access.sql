-- TASK-060: 드라이브 링크 접근 판정 (AIWITH-375). accessible / blocked / unknown, 파일 업로드는 NULL
ALTER TABLE `submissions` ADD `drive_access` text;
