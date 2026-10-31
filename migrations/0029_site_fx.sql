-- ECB public reference data, separate from visitor/person data.
CREATE TABLE site_fx_rates (
  day TEXT PRIMARY KEY NOT NULL,
  rates TEXT NOT NULL CHECK(json_valid(rates)),
  fetched_at INTEGER NOT NULL
);
CREATE TABLE site_fx_refresh (
  id TEXT PRIMARY KEY NOT NULL CHECK(id = 'ecb'),
  next_enqueue_at INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_success_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO site_fx_refresh(id) VALUES ('ecb');
ALTER TABLE site_conversions ADD COLUMN received_at INTEGER;
ALTER TABLE site_conversions ADD COLUMN eligible_at_capture INTEGER CHECK(eligible_at_capture IN (0,1));
CREATE INDEX site_conversions_received_idx ON site_conversions(site_id, received_at);
CREATE INDEX site_conversions_legacy_at_idx ON site_conversions(site_id, at) WHERE received_at IS NULL;

-- Anonymous sums use the member eligibility at capture, like site_daily_stats.
-- They survive person deletion and contain no session/person/lead/order IDs.
CREATE TABLE site_currency_totals (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  received_day TEXT NOT NULL,
  occurred_day TEXT NOT NULL,
  currency TEXT NOT NULL,
  conversions INTEGER NOT NULL,
  valued_count INTEGER NOT NULL,
  value_sum REAL,
  PRIMARY KEY(site_id,received_day,occurred_day,currency)
);
INSERT INTO site_currency_totals
SELECT c.site_id,coalesce(strftime('%Y-%m-%d',coalesce(c.received_at,c.at)/1000,'unixepoch','+9 hours'),''),
  coalesce(strftime('%Y-%m-%d',c.at/1000,'unixepoch'),''),c.currency,count(*),count(c.value),sum(coalesce(c.value,0))
FROM site_conversions c JOIN sites s ON s.id=c.site_id AND s.deleted_at IS NULL
JOIN site_sessions sess ON sess.site_id=c.site_id AND sess.id=c.session_id AND sess.is_member=0
GROUP BY 1,2,3,4;
-- Purged legacy raw rows cannot be assigned a currency/rate retrospectively.
-- Retain their anonymous count as explicitly unpriced, never invent units.
INSERT INTO site_currency_totals
SELECT d.site_id,d.day,'','',d.n-coalesce(k.n,0),d.n-coalesce(k.n,0),NULL
FROM (SELECT site_id,day,sum(conversions) AS n FROM site_daily_stats GROUP BY site_id,day) d
LEFT JOIN (SELECT site_id,received_day,sum(conversions) AS n FROM site_currency_totals GROUP BY site_id,received_day) k
  ON k.site_id=d.site_id AND k.received_day=d.day
WHERE d.n>coalesce(k.n,0);

CREATE TRIGGER site_conversion_currency_insert AFTER INSERT ON site_conversions
WHEN EXISTS(SELECT 1 FROM sites WHERE id=NEW.site_id AND deleted_at IS NULL)
 AND EXISTS(SELECT 1 FROM site_sessions WHERE site_id=NEW.site_id AND id=NEW.session_id
   AND coalesce(NEW.eligible_at_capture,CASE WHEN is_member=0 THEN 1 ELSE 0 END)=1)
BEGIN
  INSERT INTO site_currency_totals(site_id,received_day,occurred_day,currency,conversions,valued_count,value_sum)
  VALUES (NEW.site_id,coalesce(strftime('%Y-%m-%d',coalesce(NEW.received_at,NEW.at)/1000,'unixepoch','+9 hours'),''),
    coalesce(strftime('%Y-%m-%d',NEW.at/1000,'unixepoch'),''),NEW.currency,1,CASE WHEN NEW.value IS NULL THEN 0 ELSE 1 END,coalesce(NEW.value,0))
  ON CONFLICT(site_id,received_day,occurred_day,currency) DO UPDATE SET
    conversions=conversions+excluded.conversions,valued_count=valued_count+excluded.valued_count,
    value_sum=CASE WHEN value_sum IS NOT NULL AND abs(value_sum+excluded.value_sum)<=1.7976931348623157e308
      THEN value_sum+excluded.value_sum ELSE NULL END;
END;
