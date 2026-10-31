-- AIWITH-307: 반송을 실제 발송 건과 그때의 리드에만 연결한다. 기존 로그는 추정으로 연결하지 않는다.
ALTER TABLE `message_logs` ADD `provider_id` text;
ALTER TABLE `message_logs` ADD `recipient_email` text;
ALTER TABLE `message_logs` ADD `lead_created_at` integer;
CREATE INDEX `message_logs_provider_idx` ON `message_logs` (`provider_id`);
