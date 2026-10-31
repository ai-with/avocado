CREATE TABLE site_alert_settings (
 site_id text PRIMARY KEY NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
 generation text NOT NULL, enabled integer NOT NULL DEFAULT 0,
 metric text NOT NULL CHECK(metric IN ('pageviews','conversions')),
 ratio_percent integer NOT NULL, minimum_average integer NOT NULL, confirmation_days integer NOT NULL,
 next_check_at integer NOT NULL, last_checked_day text, lease_token text, lease_until integer,
 created_at integer NOT NULL, updated_at integer NOT NULL
);
CREATE INDEX site_alert_settings_due_idx ON site_alert_settings(enabled,next_check_at,site_id);
CREATE TABLE site_alert_recipients (
 site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 generation text NOT NULL, active integer NOT NULL DEFAULT 0, email_hmac text,
 last_attempt_at integer, last_delivery_id text,
 created_at integer NOT NULL, updated_at integer NOT NULL,
 PRIMARY KEY(site_id,user_id)
);
CREATE INDEX site_alert_recipients_active_idx ON site_alert_recipients(active,updated_at,site_id,user_id);
CREATE TABLE site_alert_runs (
 id text PRIMARY KEY NOT NULL, site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
 workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 generation text NOT NULL,target_day text NOT NULL,policy_json text NOT NULL,evaluation_json text NOT NULL,checked_at integer NOT NULL,
 UNIQUE(site_id,generation,target_day)
);
CREATE INDEX site_alert_runs_time_idx ON site_alert_runs(checked_at,id);
-- No FK cascade: an uncertain provider attempt must not lose its receipt when a parent disappears.
CREATE TABLE site_alert_mail_outbox (
 id text PRIMARY KEY NOT NULL, run_id text NOT NULL,site_id text NOT NULL,workspace_id text NOT NULL,
 user_id text NOT NULL,config_generation text NOT NULL,subscription_generation text NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','blocked','sending','failed','sent','cancelled','unknown','expired')),
 payload_enc text,first_attempt_at integer,last_attempt_at integer,lease_token text,
 next_attempt_at integer NOT NULL,last_enqueued_at integer,attempts integer NOT NULL DEFAULT 0,provider_id text,error_code text,
 expires_at integer NOT NULL,created_at integer NOT NULL,updated_at integer NOT NULL,
 UNIQUE(run_id,user_id,subscription_generation)
);
CREATE INDEX site_alert_mail_due_idx ON site_alert_mail_outbox(status,next_attempt_at,updated_at,id);
CREATE INDEX site_alert_mail_retention_idx ON site_alert_mail_outbox(created_at,id);

-- Rejoining or restoring a role must not reactivate a former subscription or an
-- old queued email. These fences share the owner's transaction and keep cooldowns.
CREATE TRIGGER site_alert_membership_deleted AFTER DELETE ON members
BEGIN
 UPDATE site_alert_recipients SET active=0,generation=lower(hex(randomblob(18))),email_hmac=NULL,
 updated_at=max(updated_at,CAST(strftime('%s','now') AS integer)*1000)
 WHERE user_id=OLD.user_id AND active=1 AND site_id IN(SELECT id FROM sites WHERE workspace_id=OLD.workspace_id);
END;
CREATE TRIGGER site_alert_membership_changed AFTER UPDATE OF role,workspace_id,user_id ON members
WHEN NEW.role NOT IN ('owner','editor') OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.user_id IS NOT OLD.user_id
BEGIN
 UPDATE site_alert_recipients SET active=0,generation=lower(hex(randomblob(18))),email_hmac=NULL,
 updated_at=max(updated_at,CAST(strftime('%s','now') AS integer)*1000)
 WHERE user_id=OLD.user_id AND active=1 AND site_id IN(SELECT id FROM sites WHERE workspace_id=OLD.workspace_id);
END;
CREATE TRIGGER site_alert_user_eligibility_changed AFTER UPDATE OF phone_verified_at,email ON users
WHEN NEW.phone_verified_at IS NULL OR lower(trim(NEW.email)) IS NOT lower(trim(OLD.email))
BEGIN
 UPDATE site_alert_recipients SET active=0,generation=lower(hex(randomblob(18))),email_hmac=NULL,
 updated_at=max(updated_at,CAST(strftime('%s','now') AS integer)*1000)
 WHERE user_id=OLD.id AND active=1;
END;
CREATE TRIGGER site_alert_site_deleted AFTER UPDATE OF deleted_at ON sites
WHEN NEW.deleted_at IS NOT NULL
BEGIN
 UPDATE site_alert_recipients SET active=0,generation=lower(hex(randomblob(18))),email_hmac=NULL,
 updated_at=max(updated_at,CAST(strftime('%s','now') AS integer)*1000)
 WHERE site_id=OLD.id AND active=1;
END;
