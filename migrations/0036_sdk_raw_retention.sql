-- SDK envelopes are deletable ciphertext; queues carry IDs only. Object attempts
-- deliberately have no FK: deleting a parent must never lose an uncertain PUT.
CREATE TABLE site_collect_intakes (
  id text PRIMARY KEY NOT NULL,
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  received_at integer NOT NULL,
  expires_at integer NOT NULL,
  payload_enc text NOT NULL,
  next_attempt_at integer NOT NULL DEFAULT 0
);
CREATE INDEX site_collect_intakes_due_idx ON site_collect_intakes(next_attempt_at,id);
CREATE INDEX site_collect_intakes_expiry_idx ON site_collect_intakes(expires_at,id);
CREATE INDEX site_collect_intakes_site_idx ON site_collect_intakes(site_id,id);
CREATE TABLE site_raw_batches (
  id text PRIMARY KEY NOT NULL,
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  received_at integer NOT NULL,
  expires_at integer NOT NULL,
  payload_enc text,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready')),
  write_token text,
  lease_until integer NOT NULL DEFAULT 0,
  object_key text,
  next_attempt_at integer NOT NULL DEFAULT 0
);
CREATE INDEX site_raw_batches_due_idx ON site_raw_batches(status,next_attempt_at,id);
CREATE INDEX site_raw_batches_expiry_idx ON site_raw_batches(expires_at,id);
CREATE INDEX site_raw_batches_site_idx ON site_raw_batches(site_id,id);
CREATE TABLE site_raw_objects (
  id text PRIMARY KEY NOT NULL,
  batch_id text NOT NULL,
  site_id text NOT NULL,
  key text NOT NULL UNIQUE,
  state text NOT NULL CHECK(state IN ('writing','ready','retired')),
  created_at integer NOT NULL,
  lease_until integer NOT NULL,
  checked_at integer NOT NULL DEFAULT 0,
  deleted_at integer
);
CREATE INDEX site_raw_objects_batch_idx ON site_raw_objects(batch_id,id);
CREATE INDEX site_raw_objects_site_idx ON site_raw_objects(site_id,deleted_at,id);
CREATE INDEX site_raw_objects_cleanup_idx ON site_raw_objects(state,checked_at,id);
CREATE TRIGGER privacy_collect_intake_insert BEFORE INSERT ON site_collect_intakes
WHEN NOT EXISTS(SELECT 1 FROM sites WHERE id=NEW.site_id AND workspace_id=NEW.workspace_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER privacy_raw_batch_insert BEFORE INSERT ON site_raw_batches
WHEN NOT EXISTS(SELECT 1 FROM sites WHERE id=NEW.site_id AND workspace_id=NEW.workspace_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(IGNORE); END;
