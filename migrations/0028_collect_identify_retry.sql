-- AIWITH-390: 집계 직렬화의 짧은 소유권과 독립 identify 작업/완료 영수증.
CREATE TABLE site_collect_leases (
  site_id text PRIMARY KEY NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  token text NOT NULL,
  expires_at integer NOT NULL
);
CREATE INDEX site_collect_leases_expiry_idx ON site_collect_leases(expires_at, site_id);

CREATE TABLE site_identify_jobs (
  id text PRIMARY KEY NOT NULL,
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  anon_id text NOT NULL,
  event_id text NOT NULL,
  received_at integer NOT NULL,
  expires_at integer NOT NULL,
  email_hash text,
  payload_enc text,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','cancelled','expired')),
  claim_token text,
  resolved_person_id text,
  resolved_lead_id text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at integer NOT NULL DEFAULT 0,
  last_error text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  FOREIGN KEY(site_id, session_id) REFERENCES site_sessions(site_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX site_identify_jobs_event_idx ON site_identify_jobs(site_id, event_id);
CREATE INDEX site_identify_jobs_due_idx ON site_identify_jobs(status, next_attempt_at, received_at, id);
CREATE INDEX site_identify_jobs_expiry_idx ON site_identify_jobs(expires_at, id);
CREATE INDEX site_identify_jobs_source_idx ON site_identify_jobs(site_id, session_id);
CREATE INDEX site_identify_jobs_hash_idx ON site_identify_jobs(site_id, email_hash);
