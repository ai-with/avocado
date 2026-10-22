-- 0007: 구글 로그인, 휴대폰 인증 필수(계정당 번호 1개), 비밀번호 재설정, 로그인 시도 제한 (TASK-024)
-- password_hash 는 NOT NULL 그대로 두고 구글 전용 계정은 빈 문자열을 넣는다 (users 재생성 시 FK cascade 위험)
ALTER TABLE `users` ADD `google_sub` text;
ALTER TABLE `users` ADD `phone_e164` text;
ALTER TABLE `users` ADD `phone_verified_at` integer;
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);
CREATE UNIQUE INDEX `users_phone_e164_unique` ON `users` (`phone_e164`);

CREATE TABLE `phone_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`phone_e164` text NOT NULL,
	`code_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`verified_at` integer,
	`ip` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
CREATE INDEX `phone_verifications_phone_idx` ON `phone_verifications` (`phone_e164`, `created_at`);
CREATE INDEX `phone_verifications_ip_idx` ON `phone_verifications` (`ip`, `created_at`);

CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`nonce` text NOT NULL,
	`code_verifier` text NOT NULL,
	`redirect_next` text NOT NULL,
	`created_at` integer NOT NULL
);

CREATE TABLE `password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);

CREATE TABLE `auth_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`created_at` integer NOT NULL
);
CREATE INDEX `auth_attempts_key_idx` ON `auth_attempts` (`key`, `created_at`);
