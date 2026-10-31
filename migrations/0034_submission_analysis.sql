-- AIWITH-381: positive no-audio receipt and generation-fenced pipeline claims.
ALTER TABLE audio_tracks ADD content_hash text;
ALTER TABLE processing_jobs ADD analysis_generation integer NOT NULL DEFAULT 0;
CREATE TABLE submission_analysis (
 submission_id text PRIMARY KEY NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
 audio_state text NOT NULL DEFAULT 'unknown' CHECK(audio_state IN ('unknown','none','present')),
 audio_reason text, frames_complete integer NOT NULL DEFAULT 0,
 generation integer NOT NULL DEFAULT 0, completed_generation integer NOT NULL DEFAULT -1,
 claim_token text, claim_until integer, completed_request_id text
);
CREATE TABLE submission_analysis_retries (
 submission_id text NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
 request_id text NOT NULL, generation integer NOT NULL, completed_at integer NOT NULL,
 PRIMARY KEY(submission_id,request_id)
);
INSERT INTO submission_analysis(submission_id,audio_state,completed_generation)
 SELECT s.id,CASE WHEN EXISTS(SELECT 1 FROM audio_tracks a WHERE a.submission_id=s.id) THEN 'present' ELSE 'unknown' END,
 CASE WHEN s.status='ready' THEN 0 ELSE -1 END FROM submissions s;
CREATE TRIGGER analysis_submission_insert AFTER INSERT ON submissions BEGIN
 INSERT INTO submission_analysis(submission_id) VALUES(NEW.id);
END;
CREATE TRIGGER analysis_audio_insert AFTER INSERT ON audio_tracks BEGIN
 UPDATE submission_analysis SET audio_state='present',audio_reason=NULL,generation=generation+1,
 claim_token=NULL,claim_until=NULL WHERE submission_id=NEW.submission_id;
END;
CREATE TRIGGER analysis_audio_changed AFTER UPDATE ON audio_tracks
WHEN NEW.content_hash IS NOT OLD.content_hash OR NEW.key IS NOT OLD.key OR NEW.sample_rate IS NOT OLD.sample_rate OR NEW.duration_s IS NOT OLD.duration_s
BEGIN
 UPDATE submission_analysis SET audio_state='present',audio_reason=NULL,generation=generation+1,
 claim_token=NULL,claim_until=NULL WHERE submission_id=NEW.submission_id;
END;
CREATE TRIGGER analysis_generation_changed AFTER UPDATE OF generation ON submission_analysis
WHEN NEW.generation<>OLD.generation BEGIN
 UPDATE processing_jobs SET status='queued',attempts=0,started_at=NULL,finished_at=NULL,error=NULL WHERE submission_id=NEW.submission_id;
 UPDATE submissions SET status='uploaded' WHERE id=NEW.submission_id AND status IN ('processing','ready','failed');
END;
-- Keep the existing consent/purge boundary atomic with every new receipt/claim.
CREATE TRIGGER privacy_analysis_insert BEFORE INSERT ON submission_analysis
WHEN NOT EXISTS(SELECT 1 FROM submissions s JOIN consents c ON c.id=s.consent_id AND c.guide_influencer_id=s.guide_influencer_id
 WHERE s.id=NEW.submission_id AND c.withdrawn_at IS NULL AND s.media_purged_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM media_purges p WHERE p.submission_id=s.id))
BEGIN SELECT RAISE(ABORT,'consent_withdrawn'); END;
CREATE TRIGGER privacy_analysis_update BEFORE UPDATE ON submission_analysis
WHEN NOT EXISTS(SELECT 1 FROM submissions s JOIN consents c ON c.id=s.consent_id AND c.guide_influencer_id=s.guide_influencer_id
 WHERE s.id=NEW.submission_id AND c.withdrawn_at IS NULL AND s.media_purged_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM media_purges p WHERE p.submission_id=s.id))
BEGIN SELECT RAISE(ABORT,'consent_withdrawn'); END;
