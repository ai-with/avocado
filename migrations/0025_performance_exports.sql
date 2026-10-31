-- AIWITH-284: 명시적인 캠페인 종료, 콘텐츠 세대별 썸네일, 앱 자체 Google Sheets 연결·내보내기.
ALTER TABLE campaigns ADD ends_at integer;
ALTER TABLE campaigns ADD archived_at integer;
ALTER TABLE contents ADD thumbnail_url text;
ALTER TABLE contents ADD thumbnail_key text;
ALTER TABLE contents ADD thumbnail_fetched_at integer;
ALTER TABLE contents ADD collection_revision integer NOT NULL DEFAULT 0;
CREATE INDEX contents_thumbnail_key_idx ON contents(thumbnail_key) WHERE thumbnail_key IS NOT NULL;
ALTER TABLE metric_snapshots ADD collection_token text;
ALTER TABLE metric_snapshots ADD collection_started_at integer;

-- 썸네일 put 이전부터 원장을 남긴다. 부모 삭제 후에도 미참조 사본을 회수할 수 있도록 FK가 없다.
CREATE TABLE content_thumbnail_objects (
  key text PRIMARY KEY NOT NULL,
  workspace_id text NOT NULL,
  content_id text NOT NULL,
  created_at integer NOT NULL,
  retired_at integer,
  deleted_at integer,
  checked_at integer NOT NULL DEFAULT 0
);
CREATE INDEX content_thumbnail_objects_sweep_idx ON content_thumbnail_objects(checked_at, created_at);

-- 과거 archived의 종료·보관 시각은 updated_at이나 업로드 마감으로 추정하지 않는다.
CREATE TABLE google_sheets_connections (
  user_id text PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation text NOT NULL,
  access_enc text,
  refresh_enc text,
  scope text NOT NULL DEFAULT '',
  expires_at integer,
  connected_at integer,
  revoked_at integer,
  account_email text
);
CREATE TABLE google_sheets_states (
  state_hash text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  connection_generation text NOT NULL,
  verifier_enc text NOT NULL,
  return_to text NOT NULL,
  expires_at integer NOT NULL,
  used_at integer,
  created_at integer NOT NULL
);
CREATE INDEX google_sheets_states_expiry_idx ON google_sheets_states(expires_at);
CREATE TABLE google_sheets_exports (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('leads', 'performance')),
  filters_hash text NOT NULL,
  connection_generation text NOT NULL,
  status text NOT NULL CHECK(status IN ('prepared', 'creating', 'writing', 'done', 'failed', 'unknown', 'cancelled')),
  payload_enc text,
  row_count integer NOT NULL,
  title text NOT NULL,
  spreadsheet_id text,
  error_code text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE UNIQUE INDEX google_sheets_exports_request_idx ON google_sheets_exports(user_id, request_id);
CREATE INDEX google_sheets_exports_expiry_idx ON google_sheets_exports(created_at, status);
