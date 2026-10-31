-- AIWITH-395/396: no original CSV/contact payload is stored in these ledgers.
CREATE TABLE lead_import_clocks (
 workspace_id text PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 0, privacy_epoch integer NOT NULL DEFAULT 0
);
CREATE TABLE lead_import_births (
 lead_id text PRIMARY KEY NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
 workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 revision integer NOT NULL
);
CREATE INDEX lead_import_births_ws_idx ON lead_import_births(workspace_id,lead_id);
INSERT INTO lead_import_clocks(workspace_id) SELECT id FROM workspaces;
INSERT INTO lead_import_births(lead_id,workspace_id,revision) SELECT id,workspace_id,0 FROM leads;
CREATE TRIGGER lead_import_birth_insert AFTER INSERT ON leads BEGIN
 INSERT INTO lead_import_clocks(workspace_id) VALUES(NEW.workspace_id) ON CONFLICT DO NOTHING;
 UPDATE lead_import_clocks SET revision=revision+1 WHERE workspace_id=NEW.workspace_id;
 INSERT INTO lead_import_births(lead_id,workspace_id,revision)
 SELECT NEW.id,NEW.workspace_id,revision FROM lead_import_clocks WHERE workspace_id=NEW.workspace_id;
END;
CREATE TRIGGER lead_import_privacy_delete BEFORE DELETE ON leads BEGIN
 UPDATE lead_import_clocks SET revision=revision+1,privacy_epoch=privacy_epoch+1 WHERE workspace_id=OLD.workspace_id;
END;
CREATE TRIGGER lead_import_generation_update AFTER UPDATE OF deleted_at,created_at,email,workspace_id ON leads
WHEN NEW.deleted_at IS NOT OLD.deleted_at OR NEW.created_at IS NOT OLD.created_at OR NEW.email IS NOT OLD.email OR NEW.workspace_id IS NOT OLD.workspace_id BEGIN
 INSERT INTO lead_import_clocks(workspace_id) VALUES(NEW.workspace_id) ON CONFLICT DO NOTHING;
 UPDATE lead_import_clocks SET revision=revision+1,privacy_epoch=privacy_epoch+1 WHERE workspace_id=OLD.workspace_id OR workspace_id=NEW.workspace_id;
 UPDATE lead_import_births SET workspace_id=NEW.workspace_id,revision=(SELECT revision FROM lead_import_clocks WHERE workspace_id=NEW.workspace_id) WHERE lead_id=NEW.id;
END;
CREATE TABLE lead_import_jobs (
 id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 fingerprint text NOT NULL, generation text NOT NULL,
 status text NOT NULL CHECK(status IN ('active','completed','cancelled')),
 total_rows integer NOT NULL, next_chunk integer NOT NULL DEFAULT 0,
 processed_rows integer NOT NULL DEFAULT 0, imported_rows integer NOT NULL DEFAULT 0,
 invalid_rows integer NOT NULL DEFAULT 0, skipped_rows integer NOT NULL DEFAULT 0,
 birth_revision integer NOT NULL, privacy_epoch integer NOT NULL,
 requested_at integer NOT NULL, created_at integer NOT NULL, expires_at integer NOT NULL, updated_at integer NOT NULL
);
CREATE INDEX lead_import_jobs_expiry_idx ON lead_import_jobs(expires_at,id);
CREATE INDEX lead_import_jobs_ws_idx ON lead_import_jobs(workspace_id,id);
CREATE INDEX lead_import_jobs_user_idx ON lead_import_jobs(user_id,id);
CREATE INDEX lead_import_jobs_session_idx ON lead_import_jobs(session_id,id);
CREATE TABLE lead_import_chunks (
 job_id text NOT NULL REFERENCES lead_import_jobs(id) ON DELETE CASCADE,
 chunk_no integer NOT NULL, digest text NOT NULL, claim_token text,
 status text NOT NULL CHECK(status IN ('applying','done')),
 invalid_json text NOT NULL, skipped_json text NOT NULL, result_json text,
 PRIMARY KEY(job_id,chunk_no)
);
CREATE TABLE lead_import_owned (
 job_id text NOT NULL REFERENCES lead_import_jobs(id) ON DELETE CASCADE,
 lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
 PRIMARY KEY(job_id,lead_id)
);
CREATE INDEX lead_import_owned_lead_idx ON lead_import_owned(lead_id,job_id);
