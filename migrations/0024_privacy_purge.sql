-- AIWITH-283: 개인정보 기한 정리, 사이트 쓰기 차단, 동의 세대별 미디어 파기 원장.
CREATE INDEX leads_purge_idx ON leads(deleted_at, id) WHERE deleted_at IS NOT NULL;
CREATE INDEX link_clicks_ip_purge_idx ON link_clicks(at, id) WHERE ip_hash IS NOT NULL;
CREATE INDEX sites_purge_idx ON sites(deleted_at, id) WHERE deleted_at IS NOT NULL;
CREATE INDEX site_people_lead_idx ON site_people(lead_id);
CREATE INDEX site_sessions_person_idx ON site_sessions(site_id, person_id);
CREATE INDEX site_conversions_person_idx ON site_conversions(site_id, person_id);

ALTER TABLE submissions ADD consent_id text;
ALTER TABLE submissions ADD media_purged_at integer;

-- 제출 당시 유효했던 동의가 하나로 확정되는 기록만 연결한다. 철회 경계와 이력 누락은 추정하지 않는다.
UPDATE submissions SET consent_id = (
  SELECT min(c.id) FROM consents c
  WHERE c.guide_influencer_id = submissions.guide_influencer_id
    AND c.agreed_at <= submissions.created_at
    AND (c.withdrawn_at IS NULL OR c.withdrawn_at > submissions.created_at)
  HAVING count(*) = 1
)
WHERE NOT EXISTS (
  SELECT 1 FROM consents boundary
  WHERE boundary.guide_influencer_id = submissions.guide_influencer_id
    AND boundary.withdrawn_at = submissions.created_at
);

-- 부모 행 삭제로 원장까지 사라져 R2 객체를 잃어버리지 않도록 FK cascade를 두지 않는다.
CREATE TABLE media_purges (
  submission_id text PRIMARY KEY NOT NULL,
  consent_id text NOT NULL,
  requested_at integer NOT NULL,
  due_at integer NOT NULL,
  next_attempt_at integer NOT NULL DEFAULT 0,
  completed_at integer,
  checked_at integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX media_purges_due_idx ON media_purges(next_attempt_at, due_at, checked_at);
CREATE TABLE media_purge_objects (
  id text PRIMARY KEY NOT NULL,
  submission_id text NOT NULL,
  consent_id text,
  key text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('object', 'multipart')),
  upload_id text,
  deleted_at integer
);
CREATE UNIQUE INDEX media_purge_objects_key_idx ON media_purge_objects(submission_id, key, kind);
CREATE INDEX media_purge_objects_submission_idx ON media_purge_objects(submission_id, deleted_at);

-- 기존 철회도 동의 세대가 확정되는 제출물만 예약한다. 재동의 후 새 제출물은 포함하지 않는다.
INSERT INTO media_purges (submission_id, consent_id, requested_at, due_at)
SELECT s.id, c.id, c.withdrawn_at, c.withdrawn_at
FROM submissions s JOIN consents c ON c.id = s.consent_id
WHERE c.withdrawn_at IS NOT NULL;

-- 삭제 사이트의 늦은 SDK 쓰기는 DB 실행 시에도 막는다. FK SET NULL에 의한 연결 해제는 허용한다.
CREATE TRIGGER privacy_site_sessions_insert BEFORE INSERT ON site_sessions
WHEN NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = NEW.site_id AND s.deleted_at IS NULL)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER privacy_site_sessions_update BEFORE UPDATE OF first_at, last_at, pageviews, max_scroll, visible_ms, clicks, is_member, person_id ON site_sessions
WHEN NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = NEW.site_id AND s.deleted_at IS NULL)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER privacy_site_conversions_insert BEFORE INSERT ON site_conversions
WHEN NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = NEW.site_id AND s.deleted_at IS NULL)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER privacy_site_conversions_update BEFORE UPDATE OF person_id ON site_conversions
WHEN NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = NEW.site_id AND s.deleted_at IS NULL)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER privacy_site_people_insert BEFORE INSERT ON site_people
WHEN NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = NEW.site_id AND s.deleted_at IS NULL)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER privacy_site_people_update BEFORE UPDATE OF anon_ids, external_id, email_hash ON site_people
WHEN NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = NEW.site_id AND s.deleted_at IS NULL)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER privacy_site_daily_stats_insert BEFORE INSERT ON site_daily_stats
WHEN NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = NEW.site_id AND s.deleted_at IS NULL)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER privacy_site_daily_stats_update BEFORE UPDATE ON site_daily_stats
WHEN NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = NEW.site_id AND s.deleted_at IS NULL)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER privacy_site_event_ids_insert BEFORE INSERT ON site_event_ids
WHEN NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = NEW.site_id AND s.deleted_at IS NULL)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER privacy_site_event_ids_update BEFORE UPDATE ON site_event_ids
WHEN NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = NEW.site_id AND s.deleted_at IS NULL)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER privacy_frames_insert BEFORE INSERT ON frames
WHEN EXISTS (SELECT 1 FROM media_purges p WHERE p.submission_id = NEW.submission_id)
  OR NOT EXISTS (
    SELECT 1 FROM submissions s JOIN consents c ON c.id = s.consent_id
    WHERE s.id = NEW.submission_id AND c.guide_influencer_id = s.guide_influencer_id AND c.withdrawn_at IS NULL
  )
BEGIN SELECT RAISE(ABORT, 'consent_withdrawn'); END;
CREATE TRIGGER privacy_frames_update BEFORE UPDATE OF image_key ON frames
WHEN EXISTS (SELECT 1 FROM media_purges p WHERE p.submission_id = NEW.submission_id)
  OR NOT EXISTS (
    SELECT 1 FROM submissions s JOIN consents c ON c.id = s.consent_id
    WHERE s.id = NEW.submission_id AND c.guide_influencer_id = s.guide_influencer_id AND c.withdrawn_at IS NULL
  )
BEGIN SELECT RAISE(ABORT, 'consent_withdrawn'); END;
CREATE TRIGGER privacy_audio_tracks_insert BEFORE INSERT ON audio_tracks
WHEN EXISTS (SELECT 1 FROM media_purges p WHERE p.submission_id = NEW.submission_id)
  OR NOT EXISTS (
    SELECT 1 FROM submissions s JOIN consents c ON c.id = s.consent_id
    WHERE s.id = NEW.submission_id AND c.guide_influencer_id = s.guide_influencer_id AND c.withdrawn_at IS NULL
  )
BEGIN SELECT RAISE(ABORT, 'consent_withdrawn'); END;
CREATE TRIGGER privacy_audio_tracks_update BEFORE UPDATE OF key ON audio_tracks
WHEN EXISTS (SELECT 1 FROM media_purges p WHERE p.submission_id = NEW.submission_id)
  OR NOT EXISTS (
    SELECT 1 FROM submissions s JOIN consents c ON c.id = s.consent_id
    WHERE s.id = NEW.submission_id AND c.guide_influencer_id = s.guide_influencer_id AND c.withdrawn_at IS NULL
  )
BEGIN SELECT RAISE(ABORT, 'consent_withdrawn'); END;
CREATE TRIGGER privacy_transcript_segments_insert BEFORE INSERT ON transcript_segments
WHEN EXISTS (SELECT 1 FROM media_purges p WHERE p.submission_id = NEW.submission_id)
  OR NOT EXISTS (
    SELECT 1 FROM submissions s JOIN consents c ON c.id = s.consent_id
    WHERE s.id = NEW.submission_id AND c.guide_influencer_id = s.guide_influencer_id AND c.withdrawn_at IS NULL
  )
BEGIN SELECT RAISE(ABORT, 'consent_withdrawn'); END;
CREATE TRIGGER privacy_transcript_segments_update BEFORE UPDATE OF text, translated_text, translated_lang ON transcript_segments
WHEN EXISTS (SELECT 1 FROM media_purges p WHERE p.submission_id = NEW.submission_id)
  OR NOT EXISTS (
    SELECT 1 FROM submissions s JOIN consents c ON c.id = s.consent_id
    WHERE s.id = NEW.submission_id AND c.guide_influencer_id = s.guide_influencer_id AND c.withdrawn_at IS NULL
  )
BEGIN SELECT RAISE(ABORT, 'consent_withdrawn'); END;
CREATE TRIGGER privacy_violation_candidates_insert BEFORE INSERT ON violation_candidates
WHEN EXISTS (SELECT 1 FROM media_purges p WHERE p.submission_id = NEW.submission_id)
  OR NOT EXISTS (
    SELECT 1 FROM submissions s JOIN consents c ON c.id = s.consent_id
    WHERE s.id = NEW.submission_id AND c.guide_influencer_id = s.guide_influencer_id AND c.withdrawn_at IS NULL
  )
BEGIN SELECT RAISE(ABORT, 'consent_withdrawn'); END;
CREATE TRIGGER privacy_violation_candidates_update BEFORE UPDATE OF reason, rule_content ON violation_candidates
WHEN EXISTS (SELECT 1 FROM media_purges p WHERE p.submission_id = NEW.submission_id)
  OR NOT EXISTS (
    SELECT 1 FROM submissions s JOIN consents c ON c.id = s.consent_id
    WHERE s.id = NEW.submission_id AND c.guide_influencer_id = s.guide_influencer_id AND c.withdrawn_at IS NULL
  )
BEGIN SELECT RAISE(ABORT, 'consent_withdrawn'); END;
CREATE TRIGGER privacy_submissions_insert BEFORE INSERT ON submissions
WHEN EXISTS (SELECT 1 FROM media_purges p WHERE p.submission_id = NEW.id)
  OR NOT EXISTS (SELECT 1 FROM consents c WHERE c.id = NEW.consent_id AND c.guide_influencer_id = NEW.guide_influencer_id AND c.withdrawn_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'consent_withdrawn'); END;
CREATE TRIGGER privacy_upload_parts_insert BEFORE INSERT ON upload_parts
WHEN EXISTS (SELECT 1 FROM media_purges p WHERE p.submission_id = NEW.submission_id)
  OR NOT EXISTS (SELECT 1 FROM submissions s JOIN consents c ON c.id = s.consent_id
    WHERE s.id = NEW.submission_id AND c.guide_influencer_id = s.guide_influencer_id AND c.withdrawn_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'consent_withdrawn'); END;
CREATE TRIGGER privacy_upload_parts_update BEFORE UPDATE OF etag, size ON upload_parts
WHEN EXISTS (SELECT 1 FROM media_purges p WHERE p.submission_id = NEW.submission_id)
  OR NOT EXISTS (SELECT 1 FROM submissions s JOIN consents c ON c.id = s.consent_id
    WHERE s.id = NEW.submission_id AND c.guide_influencer_id = s.guide_influencer_id AND c.withdrawn_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'consent_withdrawn'); END;
CREATE TRIGGER privacy_submissions_update BEFORE UPDATE OF original_key, upload_id, drive_url, status ON submissions
WHEN (
  (NEW.original_key IS NOT NULL AND NEW.original_key IS NOT OLD.original_key)
  OR (NEW.upload_id IS NOT NULL AND NEW.upload_id IS NOT OLD.upload_id)
  OR (NEW.drive_url IS NOT NULL AND NEW.drive_url IS NOT OLD.drive_url)
  OR (NEW.status IS NOT OLD.status AND NEW.status IN ('uploaded', 'uploaded_external', 'processing', 'ready'))
) AND (EXISTS (SELECT 1 FROM media_purges p WHERE p.submission_id = NEW.id)
  OR NOT EXISTS (SELECT 1 FROM consents c WHERE c.id = NEW.consent_id AND c.guide_influencer_id = NEW.guide_influencer_id AND c.withdrawn_at IS NULL))
BEGIN SELECT RAISE(ABORT, 'consent_withdrawn'); END;
