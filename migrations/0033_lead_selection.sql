ALTER TABLE leads ADD COLUMN search_email_v1 text;
ALTER TABLE leads ADD COLUMN search_name_v1 text;
ALTER TABLE leads ADD COLUMN search_company_v1 text;
ALTER TABLE leads ADD COLUMN search_phone_v1 text;
CREATE INDEX leads_live_seek_idx ON leads(workspace_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX leads_search_pending_idx ON leads(id) WHERE deleted_at IS NULL AND
 (search_email_v1 IS NULL OR search_name_v1 IS NULL OR search_company_v1 IS NULL OR search_phone_v1 IS NULL);
CREATE INDEX lead_sources_type_match_idx ON lead_sources(lead_id,type);
CREATE INDEX lead_sources_guide_match_idx ON lead_sources(lead_id,guide_id);
CREATE INDEX lead_sources_influencer_match_idx ON lead_sources(lead_id,influencer_id);
CREATE INDEX lead_sources_channel_match_idx ON lead_sources(lead_id,channel_key);
CREATE INDEX lead_sources_link_match_idx ON lead_sources(lead_id,link_id);
CREATE INDEX lead_tag_links_tag_match_idx ON lead_tag_links(tag_id,lead_id);
-- Old workers cannot leave stale search copies after changing the original.
-- New workers restore the affected folds in the same native transaction.
CREATE TRIGGER leads_search_profile_changed AFTER UPDATE OF email,name,company,phone ON leads
WHEN NEW.email IS NOT OLD.email OR NEW.name IS NOT OLD.name OR NEW.company IS NOT OLD.company OR NEW.phone IS NOT OLD.phone
BEGIN
 UPDATE leads SET
 search_email_v1=CASE WHEN NEW.email IS OLD.email THEN search_email_v1 ELSE NULL END,
 search_name_v1=CASE WHEN NEW.name IS OLD.name THEN search_name_v1 ELSE NULL END,
 search_company_v1=CASE WHEN NEW.company IS OLD.company THEN search_company_v1 ELSE NULL END,
 search_phone_v1=CASE WHEN NEW.phone IS OLD.phone THEN search_phone_v1 ELSE NULL END
 WHERE id=NEW.id;
END;
CREATE TRIGGER leads_search_deleted AFTER UPDATE OF deleted_at ON leads
WHEN NEW.deleted_at IS NOT NULL
BEGIN
 UPDATE leads SET search_email_v1=NULL,search_name_v1=NULL,search_company_v1=NULL,search_phone_v1=NULL WHERE id=NEW.id;
END;
