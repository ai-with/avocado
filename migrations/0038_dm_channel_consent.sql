-- DM consent is separate from lead email/alimtalk flags. There is deliberately
-- no legacy backfill or grant from comments, OAuth, username or email matching.
ALTER TABLE keyword_dm_rules ADD dm_revision integer NOT NULL DEFAULT 0 CHECK(dm_revision>=0);
CREATE TABLE dm_channel_consents (
 id text PRIMARY KEY NOT NULL,
 workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 connection_id text NOT NULL REFERENCES ig_connections(id) ON DELETE CASCADE,
 connection_generation text NOT NULL,app_hmac text NOT NULL,recipient_hmac text NOT NULL,
 recipient_namespace text NOT NULL CHECK(recipient_namespace='instagram_messaging_igsid'),
 revision integer NOT NULL CHECK(revision>0),status text NOT NULL CHECK(status IN('granted','revoked')),
 notice_digest text NOT NULL,proof_hmac text NOT NULL,
 granted_at integer,revoked_at integer,created_at integer NOT NULL,updated_at integer NOT NULL,
 CHECK(length(app_hmac)=64 AND length(recipient_hmac)=64 AND length(notice_digest)=64 AND length(proof_hmac)=64)
);
CREATE UNIQUE INDEX dm_channel_consents_scope_idx ON dm_channel_consents(workspace_id,connection_id,connection_generation,app_hmac,recipient_hmac);
CREATE TABLE dm_consent_receipts (
 proof_hmac text PRIMARY KEY NOT NULL,
 consent_id text NOT NULL REFERENCES dm_channel_consents(id) ON DELETE CASCADE,
 fingerprint text NOT NULL,revision integer NOT NULL,action text NOT NULL CHECK(action IN('grant','revoke')),
 created_at integer NOT NULL
);
-- SQLite cannot extend the original status CHECK in-place. Preserve every old
-- column, relationship and index while adding factual attempting/unknown states.
CREATE TABLE keyword_dm_sends_next (
 id text PRIMARY KEY NOT NULL,rule_id text NOT NULL REFERENCES keyword_dm_rules(id) ON DELETE CASCADE,
 comment_id text NOT NULL,ig_user_id text NOT NULL,username text,comment_text text,comment_at integer NOT NULL,sent_at integer,
 status text NOT NULL CHECK(status IN('sent','already_sent','expired','failed','queued','sending','unknown')),reason text,
 link_id text REFERENCES short_links(id) ON DELETE SET NULL,
 dm_consent_id text REFERENCES dm_channel_consents(id) ON DELETE SET NULL,dm_consent_revision integer,
 dm_app_hmac text,dm_recipient_hmac text,dm_sender_generation text,dm_rule_hmac text,dm_attempt_token text,dm_attempt_at integer
);
INSERT INTO keyword_dm_sends_next(id,rule_id,comment_id,ig_user_id,username,comment_text,comment_at,sent_at,status,reason,link_id)
 SELECT id,rule_id,comment_id,ig_user_id,username,comment_text,comment_at,sent_at,status,reason,link_id FROM keyword_dm_sends;
DROP TABLE keyword_dm_sends;
ALTER TABLE keyword_dm_sends_next RENAME TO keyword_dm_sends;
CREATE UNIQUE INDEX keyword_dm_sends_comment_idx ON keyword_dm_sends(rule_id,comment_id);
CREATE INDEX keyword_dm_sends_rule_user_idx ON keyword_dm_sends(rule_id,ig_user_id);
CREATE INDEX keyword_dm_sends_status_idx ON keyword_dm_sends(status,sent_at);
CREATE INDEX keyword_dm_sends_consent_idx ON keyword_dm_sends(dm_consent_id,status);
CREATE INDEX keyword_dm_sends_attempt_idx ON keyword_dm_sends(status,dm_attempt_at);
CREATE TRIGGER dm_consent_revision_changed AFTER UPDATE OF revision,status ON dm_channel_consents
WHEN NEW.revision<>OLD.revision OR NEW.status<>OLD.status BEGIN
 UPDATE keyword_dm_sends SET status='failed',reason='dm_consent_changed'
 WHERE dm_consent_id=OLD.id AND status='queued' AND dm_consent_revision<>NEW.revision;
END;
CREATE TRIGGER dm_consent_removed BEFORE DELETE ON dm_channel_consents BEGIN
 UPDATE keyword_dm_sends SET status='failed',reason='dm_consent_removed' WHERE dm_consent_id=OLD.id AND status='queued';
END;
CREATE TRIGGER keyword_dm_rule_consent_fence AFTER UPDATE OF workspace_id,guide_id,ig_connection_id,ig_media_id,influencer_id,keywords,message,public_reply_variants,enabled,status ON keyword_dm_rules
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR NEW.guide_id IS NOT OLD.guide_id OR NEW.ig_connection_id IS NOT OLD.ig_connection_id
 OR NEW.ig_media_id IS NOT OLD.ig_media_id OR NEW.influencer_id IS NOT OLD.influencer_id OR NEW.keywords IS NOT OLD.keywords
 OR NEW.message IS NOT OLD.message OR NEW.public_reply_variants IS NOT OLD.public_reply_variants OR NEW.enabled IS NOT OLD.enabled OR NEW.status IS NOT OLD.status BEGIN
 UPDATE keyword_dm_rules SET dm_revision=OLD.dm_revision+1 WHERE id=NEW.id;
 UPDATE keyword_dm_sends SET status='failed',reason='dm_authority_changed' WHERE rule_id=NEW.id AND status='queued';
END;
