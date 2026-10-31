ALTER TABLE message_logs ADD COLUMN lead_birth_revision integer;
-- AIWITH-398. No pricing/credit/monthly allowance is inferred here.
ALTER TABLE broadcasts ADD COLUMN generation text NOT NULL DEFAULT '';
ALTER TABLE broadcasts ADD COLUMN authorized_by text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE broadcasts ADD COLUMN authorization_generation text NOT NULL DEFAULT '';
ALTER TABLE broadcasts ADD COLUMN authorization_revoked_at integer;
ALTER TABLE broadcasts ADD COLUMN active_run_id text;
ALTER TABLE broadcasts ADD COLUMN dispatch_token text;
ALTER TABLE broadcasts ADD COLUMN delivery_state text;
ALTER TABLE automations ADD COLUMN generation text NOT NULL DEFAULT '';
ALTER TABLE automations ADD COLUMN authorized_by text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE automations ADD COLUMN authorization_generation text NOT NULL DEFAULT '';
ALTER TABLE automations ADD COLUMN authorization_revoked_at integer;
UPDATE broadcasts SET generation=lower(hex(randomblob(18)));
UPDATE automations SET generation=lower(hex(randomblob(18)));
CREATE INDEX broadcasts_authorized_idx ON broadcasts(authorized_by,workspace_id);
CREATE INDEX automations_authorized_idx ON automations(authorized_by,workspace_id);
-- Historic rows have no demonstrable standing grant. Never invent an owner.
UPDATE automations SET enabled=0;
UPDATE automation_runs SET status='skipped',reason='authorization_required' WHERE status='pending';

CREATE TABLE message_runs (
 id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 source_kind text NOT NULL CHECK(source_kind IN('broadcast','automation')),
 source_id text NOT NULL, source_run_key text NOT NULL,
 source_generation text NOT NULL, authorization_generation text NOT NULL,
 actor_id text REFERENCES users(id) ON DELETE SET NULL,
 trigger_lead_id text REFERENCES leads(id) ON DELETE CASCADE, trigger_birth_revision integer, ref_id text,
 request_fingerprint text,
 status text NOT NULL CHECK(status IN('scheduled','preparing','ready','completed','cancelled','blocked')),
 channel text NOT NULL CHECK(channel IN('email','alimtalk')), kind text NOT NULL CHECK(kind IN('info','ad')),
 due_at integer NOT NULL, snapshot_enc text, enumeration_done integer NOT NULL DEFAULT 0,
 target_count integer NOT NULL DEFAULT 0, eligible_count integer NOT NULL DEFAULT 0,
 completed_count integer NOT NULL DEFAULT 0, accepted_count integer NOT NULL DEFAULT 0,
 skipped_count integer NOT NULL DEFAULT 0, failed_count integer NOT NULL DEFAULT 0, unknown_count integer NOT NULL DEFAULT 0,
 reasons_json text NOT NULL DEFAULT '{}', lease_token text,lease_until integer,next_enqueue_at integer NOT NULL DEFAULT 0,
 error_code text,created_at integer NOT NULL,updated_at integer NOT NULL,
 UNIQUE(source_kind,source_run_key)
);
CREATE INDEX message_runs_due_idx ON message_runs(status,due_at,next_enqueue_at,id);
CREATE INDEX message_runs_ws_idx ON message_runs(workspace_id,created_at,id);
CREATE INDEX message_runs_source_idx ON message_runs(source_kind,source_id,id);
CREATE INDEX message_runs_actor_idx ON message_runs(actor_id,workspace_id);
CREATE INDEX message_runs_lead_idx ON message_runs(trigger_lead_id);
CREATE TABLE message_deliveries (
 id text PRIMARY KEY NOT NULL, run_id text NOT NULL REFERENCES message_runs(id) ON DELETE CASCADE,
 workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 lead_id text REFERENCES leads(id) ON DELETE SET NULL,lead_birth_revision integer NOT NULL,lead_created_at integer NOT NULL,
 status text NOT NULL CHECK(status IN('queued','deferred','claimed','sending','retry','accepted','skipped','failed','unknown','cancelled','blocked')),
 reason text,next_attempt_at integer NOT NULL,last_enqueued_at integer,lease_token text,lease_until integer,
 payload_enc text,request_hash text,provider_fingerprint text,recipient_hmac text,
 first_http_at integer,last_attempt_at integer,attempts integer NOT NULL DEFAULT 0,
 provider_id text,created_at integer NOT NULL,updated_at integer NOT NULL,
 UNIQUE(run_id,lead_id,lead_birth_revision)
);
CREATE INDEX message_deliveries_due_idx ON message_deliveries(status,next_attempt_at,last_enqueued_at,id);
CREATE INDEX message_deliveries_run_idx ON message_deliveries(run_id,status,id);
CREATE INDEX message_deliveries_lead_idx ON message_deliveries(lead_id,run_id);
CREATE INDEX message_deliveries_ws_idx ON message_deliveries(workspace_id,id);
-- Opaque evidence survives parent deletion. No recipient/body/lead/user/WS here.
CREATE TABLE message_delivery_receipts (
 delivery_id text PRIMARY KEY NOT NULL,request_hash text NOT NULL,provider_fingerprint text NOT NULL,
 first_http_at integer NOT NULL,status text NOT NULL CHECK(status IN('attempting','accepted','failed','unknown')),
 has_uncertain_attempt integer NOT NULL DEFAULT 0 CHECK(has_uncertain_attempt IN(0,1)),
 provider_id text,error_code text,expires_at integer NOT NULL,updated_at integer NOT NULL
);
CREATE INDEX message_delivery_receipts_expiry_idx ON message_delivery_receipts(expires_at,delivery_id);
CREATE TABLE email_bounce_pending (
 provider_id text NOT NULL,delivery_id text NOT NULL,recipient_hmac text NOT NULL,
 bounced_at integer NOT NULL,expires_at integer NOT NULL,
 PRIMARY KEY(provider_id,delivery_id,recipient_hmac)
);
CREATE INDEX email_bounce_pending_expiry_idx ON email_bounce_pending(expires_at,provider_id);
CREATE INDEX email_bounce_pending_delivery_idx ON email_bounce_pending(delivery_id);

CREATE TRIGGER message_delivery_insert_count AFTER INSERT ON message_deliveries BEGIN
 UPDATE message_runs SET
 target_count=target_count+1,updated_at=max(updated_at,NEW.updated_at),
 completed_count=completed_count+CASE WHEN NEW.status IN('accepted','skipped','failed','unknown','cancelled') THEN 1 ELSE 0 END,
 accepted_count=accepted_count+CASE WHEN NEW.status='accepted' THEN 1 ELSE 0 END,
 skipped_count=skipped_count+CASE WHEN NEW.status IN('skipped','cancelled') THEN 1 ELSE 0 END,
 failed_count=failed_count+CASE WHEN NEW.status='failed' THEN 1 ELSE 0 END,
 unknown_count=unknown_count+CASE WHEN NEW.status='unknown' THEN 1 ELSE 0 END,
 reasons_json=CASE WHEN NEW.status IN('skipped','failed','unknown','cancelled') AND NEW.reason IS NOT NULL
 THEN json_set(reasons_json,'$."'||NEW.reason||'"',coalesce(json_extract(reasons_json,'$."'||NEW.reason||'"'),0)+1) ELSE reasons_json END
 WHERE id=NEW.run_id;
END;
CREATE TRIGGER message_delivery_update_count AFTER UPDATE OF status,reason ON message_deliveries
WHEN NEW.status IS NOT OLD.status OR NEW.reason IS NOT OLD.reason BEGIN
 UPDATE message_runs SET
 updated_at=max(updated_at,NEW.updated_at),
 completed_count=completed_count+(CASE WHEN NEW.status IN('accepted','skipped','failed','unknown','cancelled') THEN 1 ELSE 0 END)-(CASE WHEN OLD.status IN('accepted','skipped','failed','unknown','cancelled') THEN 1 ELSE 0 END),
 accepted_count=accepted_count+(CASE WHEN NEW.status='accepted' THEN 1 ELSE 0 END)-(CASE WHEN OLD.status='accepted' THEN 1 ELSE 0 END),
 skipped_count=skipped_count+(CASE WHEN NEW.status IN('skipped','cancelled') THEN 1 ELSE 0 END)-(CASE WHEN OLD.status IN('skipped','cancelled') THEN 1 ELSE 0 END),
 failed_count=failed_count+(CASE WHEN NEW.status='failed' THEN 1 ELSE 0 END)-(CASE WHEN OLD.status='failed' THEN 1 ELSE 0 END),
 unknown_count=unknown_count+(CASE WHEN NEW.status='unknown' THEN 1 ELSE 0 END)-(CASE WHEN OLD.status='unknown' THEN 1 ELSE 0 END),
 reasons_json=CASE WHEN OLD.status IN('skipped','failed','unknown','cancelled') AND OLD.reason IS NOT NULL
 THEN json_set(reasons_json,'$."'||OLD.reason||'"',max(0,coalesce(json_extract(reasons_json,'$."'||OLD.reason||'"'),0)-1)) ELSE reasons_json END
 WHERE id=NEW.run_id;
 UPDATE message_runs SET reasons_json=json_set(reasons_json,'$."'||NEW.reason||'"',coalesce(json_extract(reasons_json,'$."'||NEW.reason||'"'),0)+1)
 WHERE id=NEW.run_id AND NEW.status IN('skipped','failed','unknown','cancelled') AND NEW.reason IS NOT NULL;
 UPDATE message_runs SET status='completed' WHERE id=NEW.run_id AND status='ready' AND enumeration_done=1 AND completed_count=target_count;
END;
CREATE TRIGGER message_run_sync AFTER UPDATE OF completed_count,accepted_count,skipped_count,failed_count,unknown_count,reasons_json,status ON message_runs BEGIN
 UPDATE broadcasts SET
 stats=json_object('eligible',NEW.eligible_count,'sent',NEW.accepted_count,'skipped',NEW.skipped_count,'failed',NEW.failed_count,'unknown',NEW.unknown_count,'remaining',NEW.target_count-NEW.completed_count,'reasons',json(NEW.reasons_json)),
 delivery_state=CASE WHEN generation<>NEW.source_generation THEN delivery_state WHEN NEW.status='completed' AND NEW.unknown_count>0 THEN 'completed_unknown' ELSE NEW.status END,
 status=CASE WHEN generation=NEW.source_generation AND NEW.status='completed' THEN 'sent' ELSE status END,
 sent_at=CASE WHEN generation=NEW.source_generation AND NEW.status='completed' THEN NEW.updated_at ELSE sent_at END
 WHERE id=NEW.source_id AND NEW.source_kind='broadcast' AND active_run_id=NEW.id;
 INSERT INTO automation_runs(id,automation_id,lead_id,ref_id,due_at,status,reason,created_at)
 SELECT NEW.id,NEW.source_id,NEW.trigger_lead_id,NEW.ref_id,NEW.due_at,
 CASE WHEN NEW.accepted_count>0 THEN 'sent' WHEN NEW.skipped_count>0 THEN 'skipped' ELSE 'failed' END,
 CASE WHEN NEW.accepted_count>0 THEN NULL WHEN NEW.unknown_count>0 THEN 'delivery_unknown' ELSE (SELECT reason FROM message_deliveries WHERE run_id=NEW.id LIMIT 1) END,NEW.created_at
 WHERE NEW.source_kind='automation' AND NEW.status='completed' AND NEW.trigger_lead_id IS NOT NULL
 ON CONFLICT(automation_id,lead_id,ref_id) DO UPDATE SET
 status=CASE WHEN automation_runs.status='sent' THEN 'sent' ELSE excluded.status END,
 reason=CASE WHEN automation_runs.status='sent' THEN NULL ELSE excluded.reason END WHERE automation_runs.id=excluded.id;
END;
CREATE TRIGGER message_run_scrub AFTER UPDATE OF status ON message_runs
WHEN NEW.status IN('completed','cancelled') BEGIN
 UPDATE message_runs SET snapshot_enc=NULL WHERE id=NEW.id;
END;
CREATE TRIGGER message_delivery_unknown_receipt AFTER UPDATE OF status ON message_deliveries
WHEN NEW.status='unknown' BEGIN
 UPDATE message_delivery_receipts SET status='unknown',has_uncertain_attempt=1,error_code=coalesce(NEW.reason,'delivery_unknown') WHERE delivery_id=NEW.id AND status='attempting';
END;
CREATE TRIGGER message_delivery_delete BEFORE DELETE ON message_deliveries BEGIN
 UPDATE message_delivery_receipts SET status='unknown',has_uncertain_attempt=1,error_code='parent_removed' WHERE delivery_id=OLD.id AND status='attempting';
 DELETE FROM email_bounce_pending WHERE delivery_id=OLD.id;
END;

-- Legacy workers cannot schedule/claim new-engine records during rollout.
CREATE TRIGGER message_broadcast_schedule_fence BEFORE UPDATE OF status ON broadcasts
WHEN NEW.status='scheduled' AND OLD.status IS NOT NEW.status AND NOT EXISTS(SELECT 1 FROM message_runs r WHERE r.id=NEW.active_run_id AND r.source_kind='broadcast' AND r.source_id=NEW.id AND r.source_generation=NEW.generation AND r.status='scheduled') BEGIN
 SELECT RAISE(ABORT,'message_authorization_required');
END;
CREATE TRIGGER message_broadcast_claim_fence BEFORE UPDATE OF status ON broadcasts
WHEN NEW.status='sending' AND OLD.status IS NOT NEW.status AND (NEW.dispatch_token IS OLD.dispatch_token OR NOT EXISTS(SELECT 1 FROM message_runs r WHERE r.id=NEW.active_run_id AND r.status='preparing' AND r.lease_token=NEW.dispatch_token)) BEGIN
 SELECT RAISE(ABORT,'message_native_claim_required');
END;
CREATE TRIGGER message_rule_enable_fence BEFORE UPDATE OF enabled ON automations
WHEN NEW.enabled=1 AND (NEW.generation='' OR NEW.authorization_generation='' OR NEW.authorization_revoked_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM users u JOIN members m ON m.user_id=u.id WHERE u.id=NEW.authorized_by AND u.phone_verified_at IS NOT NULL AND m.workspace_id=NEW.workspace_id AND m.role IN('owner','editor'))) BEGIN
 SELECT RAISE(ABORT,'message_authorization_required');
END;
CREATE TRIGGER message_legacy_enqueue_fence BEFORE INSERT ON automation_runs
WHEN NEW.status='pending' AND EXISTS(SELECT 1 FROM automations WHERE id=NEW.automation_id AND generation<>'') BEGIN SELECT RAISE(ABORT,'message_legacy_enqueue_blocked'); END;
CREATE TRIGGER message_broadcast_generation_fence BEFORE UPDATE OF name,template,audience,channel,kind ON broadcasts
WHEN NEW.generation IS OLD.generation AND (NEW.name IS NOT OLD.name OR NEW.template IS NOT OLD.template OR NEW.audience IS NOT OLD.audience OR NEW.channel IS NOT OLD.channel OR NEW.kind IS NOT OLD.kind) BEGIN
 SELECT RAISE(ABORT,'message_generation_required');
END;
CREATE TRIGGER message_rule_generation_fence BEFORE UPDATE OF name,template,target,delay_minutes,channel,kind ON automations
WHEN NEW.generation IS OLD.generation AND (NEW.name IS NOT OLD.name OR NEW.template IS NOT OLD.template OR NEW.target IS NOT OLD.target OR NEW.delay_minutes IS NOT OLD.delay_minutes OR NEW.channel IS NOT OLD.channel OR NEW.kind IS NOT OLD.kind) BEGIN
 SELECT RAISE(ABORT,'message_generation_required');
END;

CREATE TRIGGER message_member_removed BEFORE DELETE ON members BEGIN
 UPDATE broadcasts SET authorization_generation=lower(hex(randomblob(18))),authorization_revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE workspace_id=OLD.workspace_id AND authorized_by=OLD.user_id;
 UPDATE automations SET enabled=0,authorization_generation=lower(hex(randomblob(18))),authorization_revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE workspace_id=OLD.workspace_id AND authorized_by=OLD.user_id;
 UPDATE message_runs SET status='cancelled',snapshot_enc=NULL,error_code='authorization_required' WHERE workspace_id=OLD.workspace_id AND actor_id=OLD.user_id AND status IN('scheduled','preparing','ready','blocked');
 UPDATE message_deliveries SET status=CASE WHEN first_http_at IS NULL THEN 'cancelled' ELSE 'unknown' END,reason='authorization_required',payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL WHERE workspace_id=OLD.workspace_id AND run_id IN(SELECT id FROM message_runs WHERE actor_id=OLD.user_id) AND status NOT IN('accepted','skipped','failed','unknown','cancelled');
END;
CREATE TRIGGER message_member_demoted AFTER UPDATE OF role,workspace_id,user_id ON members
WHEN OLD.role IN('owner','editor') AND (NEW.role NOT IN('owner','editor') OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.user_id IS NOT OLD.user_id) BEGIN
 UPDATE broadcasts SET authorization_generation=lower(hex(randomblob(18))),authorization_revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE workspace_id=OLD.workspace_id AND authorized_by=OLD.user_id;
 UPDATE automations SET enabled=0,authorization_generation=lower(hex(randomblob(18))),authorization_revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE workspace_id=OLD.workspace_id AND authorized_by=OLD.user_id;
 UPDATE message_runs SET status='cancelled',snapshot_enc=NULL,error_code='authorization_required' WHERE workspace_id=OLD.workspace_id AND actor_id=OLD.user_id AND status IN('scheduled','preparing','ready','blocked');
 UPDATE message_deliveries SET status=CASE WHEN first_http_at IS NULL THEN 'cancelled' ELSE 'unknown' END,reason='authorization_required',payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL WHERE workspace_id=OLD.workspace_id AND run_id IN(SELECT id FROM message_runs WHERE actor_id=OLD.user_id) AND status NOT IN('accepted','skipped','failed','unknown','cancelled');
END;
CREATE TRIGGER message_actor_unverified AFTER UPDATE OF phone_verified_at ON users
WHEN NEW.phone_verified_at IS NULL AND OLD.phone_verified_at IS NOT NULL BEGIN
 UPDATE broadcasts SET authorization_generation=lower(hex(randomblob(18))),authorization_revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE authorized_by=OLD.id;
 UPDATE automations SET enabled=0,authorization_generation=lower(hex(randomblob(18))),authorization_revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE authorized_by=OLD.id;
 UPDATE message_runs SET status='cancelled',snapshot_enc=NULL,error_code='authorization_required' WHERE actor_id=OLD.id AND status IN('scheduled','preparing','ready','blocked');
 UPDATE message_deliveries SET status=CASE WHEN first_http_at IS NULL THEN 'cancelled' ELSE 'unknown' END,reason='authorization_required',payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL WHERE run_id IN(SELECT id FROM message_runs WHERE actor_id=OLD.id) AND status NOT IN('accepted','skipped','failed','unknown','cancelled');
END;
CREATE TRIGGER message_actor_deleted BEFORE DELETE ON users BEGIN
 UPDATE broadcasts SET authorization_generation=lower(hex(randomblob(18))),authorization_revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE authorized_by=OLD.id;
 UPDATE automations SET enabled=0,authorization_generation=lower(hex(randomblob(18))),authorization_revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE authorized_by=OLD.id;
 UPDATE message_runs SET status='cancelled',snapshot_enc=NULL,error_code='authorization_required' WHERE actor_id=OLD.id AND status IN('scheduled','preparing','ready','blocked');
 UPDATE message_deliveries SET status=CASE WHEN first_http_at IS NULL THEN 'cancelled' ELSE 'unknown' END,reason='authorization_required',payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL WHERE run_id IN(SELECT id FROM message_runs WHERE actor_id=OLD.id) AND status NOT IN('accepted','skipped','failed','unknown','cancelled');
END;
CREATE TRIGGER message_broadcast_changed AFTER UPDATE OF generation ON broadcasts
WHEN NEW.generation IS NOT OLD.generation BEGIN
 UPDATE message_runs SET status='cancelled',snapshot_enc=NULL,error_code='source_changed' WHERE source_kind='broadcast' AND source_id=OLD.id AND source_generation=OLD.generation AND status IN('scheduled','preparing','ready','blocked');
 UPDATE message_deliveries SET status=CASE WHEN first_http_at IS NULL THEN 'cancelled' ELSE 'unknown' END,reason='source_changed',payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL WHERE run_id IN(SELECT id FROM message_runs WHERE source_kind='broadcast' AND source_id=OLD.id AND source_generation=OLD.generation) AND status NOT IN('accepted','skipped','failed','unknown','cancelled');
END;
CREATE TRIGGER message_rule_changed AFTER UPDATE OF generation ON automations
WHEN NEW.generation IS NOT OLD.generation BEGIN
 UPDATE message_runs SET status='cancelled',snapshot_enc=NULL,error_code='source_changed' WHERE source_kind='automation' AND source_id=OLD.id AND source_generation=OLD.generation AND status IN('scheduled','preparing','ready','blocked');
 UPDATE message_deliveries SET status=CASE WHEN first_http_at IS NULL THEN 'cancelled' ELSE 'unknown' END,reason='source_changed',payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL WHERE run_id IN(SELECT id FROM message_runs WHERE source_kind='automation' AND source_id=OLD.id AND source_generation=OLD.generation) AND status NOT IN('accepted','skipped','failed','unknown','cancelled');
END;
CREATE TRIGGER message_broadcast_removed BEFORE DELETE ON broadcasts BEGIN
 UPDATE message_runs SET status='cancelled',snapshot_enc=NULL,error_code='source_changed' WHERE source_kind='broadcast' AND source_id=OLD.id AND status IN('scheduled','preparing','ready','blocked');
 UPDATE message_deliveries SET status=CASE WHEN first_http_at IS NULL THEN 'cancelled' ELSE 'unknown' END,reason='source_changed',payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL WHERE run_id IN(SELECT id FROM message_runs WHERE source_kind='broadcast' AND source_id=OLD.id) AND status NOT IN('accepted','skipped','failed','unknown','cancelled');
END;
CREATE TRIGGER message_rule_removed BEFORE DELETE ON automations BEGIN
 UPDATE message_runs SET status='cancelled',snapshot_enc=NULL,error_code='source_changed' WHERE source_kind='automation' AND source_id=OLD.id AND status IN('scheduled','preparing','ready','blocked');
 UPDATE message_deliveries SET status=CASE WHEN first_http_at IS NULL THEN 'cancelled' ELSE 'unknown' END,reason='source_changed',payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL WHERE run_id IN(SELECT id FROM message_runs WHERE source_kind='automation' AND source_id=OLD.id) AND status NOT IN('accepted','skipped','failed','unknown','cancelled');
END;
CREATE TRIGGER message_lead_delete BEFORE DELETE ON leads BEGIN
 DELETE FROM email_bounce_pending WHERE delivery_id IN(SELECT id FROM message_deliveries WHERE lead_id=OLD.id);
 UPDATE message_deliveries SET status=CASE WHEN first_http_at IS NULL THEN 'cancelled' ELSE 'unknown' END,reason='lead_deleted',payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL WHERE lead_id=OLD.id AND status NOT IN('accepted','skipped','failed','unknown','cancelled');
END;
CREATE TRIGGER message_lead_revoked AFTER UPDATE OF deleted_at,unsubscribed_at,bounced_at,marketing_opt_in,alimtalk_opt_in,email,phone,created_at,workspace_id ON leads
WHEN NEW.deleted_at IS NOT NULL OR coalesce(NEW.unsubscribed_at,0)<>0 OR NEW.email IS NOT OLD.email OR NEW.created_at IS NOT OLD.created_at OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.phone IS NOT OLD.phone OR NEW.bounced_at IS NOT OLD.bounced_at OR NEW.marketing_opt_in IS NOT OLD.marketing_opt_in OR NEW.alimtalk_opt_in IS NOT OLD.alimtalk_opt_in BEGIN
 DELETE FROM email_bounce_pending WHERE delivery_id IN(SELECT id FROM message_deliveries WHERE lead_id=NEW.id AND (NEW.deleted_at IS NOT NULL OR NEW.email IS NOT OLD.email OR NEW.created_at IS NOT OLD.created_at OR NEW.workspace_id IS NOT OLD.workspace_id));
 UPDATE message_deliveries SET status=CASE WHEN first_http_at IS NULL THEN 'cancelled' ELSE 'unknown' END,
 reason=CASE WHEN NEW.deleted_at IS NOT NULL THEN 'lead_deleted' WHEN coalesce(NEW.unsubscribed_at,0)<>0 THEN 'unsubscribed'
 WHEN coalesce(NEW.bounced_at,0)<>0 AND run_id IN(SELECT id FROM message_runs WHERE channel='email') THEN 'bounced'
 WHEN run_id IN(SELECT id FROM message_runs WHERE channel='alimtalk') AND (NEW.phone IS NULL OR NEW.phone='') THEN 'no_phone'
 WHEN run_id IN(SELECT id FROM message_runs WHERE channel='alimtalk') AND NEW.alimtalk_opt_in<>1 THEN 'no_alimtalk_consent'
 WHEN run_id IN(SELECT id FROM message_runs WHERE channel='email' AND kind='ad') AND NEW.marketing_opt_in<>1 THEN 'no_consent' ELSE 'lead_changed' END,
 payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL WHERE lead_id=NEW.id AND status NOT IN('accepted','skipped','failed','unknown','cancelled') AND (
 NEW.deleted_at IS NOT NULL OR coalesce(NEW.unsubscribed_at,0)<>0 OR NEW.email IS NOT OLD.email OR NEW.created_at IS NOT OLD.created_at OR NEW.workspace_id IS NOT OLD.workspace_id OR
 (coalesce(NEW.bounced_at,0)<>0 AND run_id IN(SELECT id FROM message_runs WHERE channel='email')) OR
 (NEW.marketing_opt_in<>1 AND run_id IN(SELECT id FROM message_runs WHERE channel='email' AND kind='ad')) OR
 ((NEW.alimtalk_opt_in<>1 OR NEW.phone IS NULL OR NEW.phone='' OR NEW.phone IS NOT OLD.phone) AND run_id IN(SELECT id FROM message_runs WHERE channel='alimtalk')));
END;
