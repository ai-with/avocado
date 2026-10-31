-- AIWITH-285: 검증된 연결 세대, 일회용 OAuth state, 수신자별 재연결 알림 원장.
ALTER TABLE ig_connections ADD generation text NOT NULL DEFAULT '';
ALTER TABLE ig_connections ADD connect_expires_at integer;
ALTER TABLE ig_connections ADD grants_verified_at integer;
ALTER TABLE ig_connections ADD disconnected_at integer;
ALTER TABLE ig_connections ADD disconnected_reason text;
UPDATE ig_connections SET generation = lower(hex(randomblob(16))) WHERE generation = '';
-- 기존 scopes는 과거 코드가 요청값으로 저장했으므로 실제 grant라고 추정하지 않는다.
CREATE INDEX ig_connections_expiry_idx ON ig_connections(expires_at, id) WHERE disconnected_at IS NULL AND revoked_at IS NULL;

-- 배포 중 남은 구 Worker가 새 grant 증명·연결 세대를 재사용하지 못하게 한다.
CREATE TRIGGER ig_connection_generation_required
BEFORE UPDATE OF token_enc, scopes, grants_verified_at, revoked_at, disconnected_at ON ig_connections
WHEN (NEW.token_enc IS NOT OLD.token_enc OR NEW.scopes IS NOT OLD.scopes
  OR NEW.grants_verified_at IS NOT OLD.grants_verified_at OR NEW.revoked_at IS NOT OLD.revoked_at
  OR NEW.disconnected_at IS NOT OLD.disconnected_at) AND NEW.generation IS OLD.generation
BEGIN
  SELECT RAISE(ABORT, 'ig_generation_required');
END;

CREATE TRIGGER ig_connection_insert_proof_required
BEFORE INSERT ON ig_connections
WHEN NEW.token_enc IS NOT NULL AND (NEW.generation = '' OR NEW.grants_verified_at IS NULL OR NEW.grants_verified_at <= 0)
BEGIN
  SELECT RAISE(ABORT, 'ig_connection_proof_required');
END;

CREATE TABLE ig_oauth_states (
  state_hash text PRIMARY KEY NOT NULL,
  nonce_hash text NOT NULL,
  target text NOT NULL CHECK(target IN ('influencer', 'client_brand', 'brand_sender')),
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id text NOT NULL REFERENCES ig_connections(id) ON DELETE CASCADE,
  connection_generation text NOT NULL,
  guide_influencer_id text REFERENCES guide_influencers(id) ON DELETE CASCADE,
  connect_token_hash text,
  guide_token_hash text,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  session_id text REFERENCES sessions(id) ON DELETE CASCADE,
  return_mode text NOT NULL CHECK(return_mode IN ('guide', 'connect', 'settings')),
  return_path text NOT NULL,
  lang text NOT NULL CHECK(lang IN ('ko', 'en')),
  expires_at integer NOT NULL,
  used_at integer,
  created_at integer NOT NULL
);
CREATE INDEX ig_oauth_states_expiry_idx ON ig_oauth_states(expires_at);

-- 부모 삭제·중단 뒤에도 발송 여부를 잃지 않는다. 전송 전에 현재 부모·권한·연결 세대를 확인한다.
CREATE TABLE ig_disconnect_mail_outbox (
  id text PRIMARY KEY NOT NULL,
  connection_id text NOT NULL,
  connection_generation text NOT NULL,
  workspace_id text NOT NULL,
  recipient_kind text NOT NULL CHECK(recipient_kind IN ('brand', 'influencer')),
  recipient_id text NOT NULL,
  reason text NOT NULL,
  disconnected_at integer NOT NULL,
  status text NOT NULL CHECK(status IN ('queued', 'sending', 'blocked', 'sent', 'failed', 'unknown', 'cancelled')),
  payload_enc text,
  first_attempt_at integer,
  last_attempt_at integer,
  next_attempt_at integer NOT NULL DEFAULT 0,
  lease_token text,
  attempts integer NOT NULL DEFAULT 0,
  provider_id text,
  error_code text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE UNIQUE INDEX ig_disconnect_mail_recipient_idx ON ig_disconnect_mail_outbox(connection_id, connection_generation, recipient_kind, recipient_id);
CREATE INDEX ig_disconnect_mail_due_idx ON ig_disconnect_mail_outbox(status, next_attempt_at, updated_at);
