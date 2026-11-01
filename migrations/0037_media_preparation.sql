-- Optional private media preparation. Source identity and every attempted key
-- remain app-owned. These ledgers intentionally survive parent deletion.
ALTER TABLE submissions ADD original_etag text;
CREATE TABLE media_preparations (
 id text PRIMARY KEY NOT NULL, submission_id text NOT NULL, consent_id text NOT NULL,
 source_key text NOT NULL, source_etag text NOT NULL, source_bytes integer NOT NULL,
 generation integer NOT NULL, created_at integer NOT NULL, lease_until integer NOT NULL,
 state text NOT NULL CHECK(state IN('preparing','selected','failed','retired')),
 selected_generation integer, video_key text, audio_key text, audio_state text,
 duration_s real, input_sha256 text, error text
);
CREATE UNIQUE INDEX media_preparations_active_idx ON media_preparations(submission_id) WHERE state='preparing';
CREATE UNIQUE INDEX media_preparations_selected_idx ON media_preparations(submission_id) WHERE state='selected';
CREATE INDEX media_preparations_source_idx ON media_preparations(submission_id,source_etag,generation,state);
CREATE TABLE prepared_media_objects (
 id text PRIMARY KEY NOT NULL, job_id text NOT NULL, submission_id text NOT NULL, consent_id text NOT NULL,
 name text NOT NULL CHECK(name IN('audio.wav','video.mp4')), key text NOT NULL UNIQUE,
 bytes integer NOT NULL, sha256 text NOT NULL, created_at integer NOT NULL,
 write_until integer NOT NULL, completed_at integer, stored_etag text,
 retired_at integer, deleted_at integer, checked_at integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX prepared_media_objects_job_name_idx ON prepared_media_objects(job_id,name);
CREATE INDEX prepared_media_objects_sub_idx ON prepared_media_objects(submission_id,id);
CREATE INDEX prepared_media_objects_cleanup_idx ON prepared_media_objects(retired_at,checked_at,id);
CREATE TRIGGER prepared_parent_deleted AFTER DELETE ON submissions BEGIN
 UPDATE media_preparations SET state='retired' WHERE submission_id=OLD.id;
 UPDATE media_purge_objects SET retired_at=coalesce(retired_at,CAST(strftime('%s','now') AS integer)*1000)
 WHERE submission_id=OLD.id AND key IN(SELECT key FROM prepared_media_objects WHERE submission_id=OLD.id);
END;
CREATE TRIGGER prepared_generation_changed AFTER UPDATE OF generation ON submission_analysis
WHEN NEW.generation<>OLD.generation BEGIN
 UPDATE media_preparations SET state='retired' WHERE submission_id=NEW.submission_id AND state='selected' AND selected_generation<>NEW.generation;
 UPDATE media_purge_objects SET retired_at=coalesce(retired_at,CAST(strftime('%s','now') AS integer)*1000)
 WHERE submission_id=NEW.submission_id AND key IN(SELECT o.key FROM prepared_media_objects o JOIN media_preparations p ON p.id=o.job_id WHERE p.state='retired')
 AND NOT EXISTS(SELECT 1 FROM audio_tracks a WHERE a.submission_id=NEW.submission_id AND a.key=media_purge_objects.key);
END;
