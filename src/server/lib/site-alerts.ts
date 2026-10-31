import { newToken, sha256Hex } from "./ids";
import { ALERT_DAY_MS, ALERT_RETENTION_MS, alertDay, alertDayStart, nextAlertCheck, shiftAlertDay } from "./site-alert-policy";
import { activeAlertRecipientSql, invalidateAlertRecipientsSql, alertAuthoritySql, alertMailConfigured, alertPolicy, readAlertEvaluation, type AlertSettingsRow } from "./site-alert-common";

const LEASE_MS = 5 * 60_000;
export const ALERT_SITE_BATCH = 20, ALERT_MAIL_BATCH = 50, ALERT_CLEANUP_BATCH = 100;
const idBody = (payload: unknown): { siteId: string; generation: string } => {
  if (!payload || typeof payload !== "object") throw new Error("site_alert_invalid");
  const value = payload as Record<string, unknown>;
  if (typeof value.siteId !== "string" || !value.siteId || value.siteId.length > 100 || typeof value.generation !== "string" || value.generation.length > 100) throw new Error("site_alert_invalid");
  return { siteId: value.siteId, generation: value.generation };
};
export async function checkSiteAlert(payload: unknown, env: Env): Promise<void> {
  const { siteId, generation } = idBody(payload), at = Date.now();
  let lease: string | null = null;
  try {
    const setting = await env.DB.prepare(`SELECT a.*,s.workspace_id,s.name,s.first_event_at FROM site_alert_settings a JOIN sites s ON s.id=a.site_id
      WHERE a.site_id=? AND a.generation=? AND a.enabled=1 AND s.deleted_at IS NULL`).bind(siteId, generation).first<AlertSettingsRow & { workspace_id: string; name: string; first_event_at: number | null }>();
    if (!setting) return;
    const target = shiftAlertDay(alertDay(at), -1);
    if (setting.last_checked_day && setting.last_checked_day >= target) return;
    if (at < alertDayStart(alertDay(at)) + 9 * 3_600_000) return;
    lease = newToken(18);
    const claim = await env.DB.prepare(`UPDATE site_alert_settings SET lease_token=?,lease_until=? WHERE site_id=? AND generation=? AND enabled=1
      AND (last_checked_day IS NULL OR last_checked_day<?) AND (lease_until IS NULL OR lease_until<=?) RETURNING site_id`).bind(lease, at + LEASE_MS, siteId, generation, target, at).first();
    if (!claim) return;
    const policy = alertPolicy(setting), evaluation = await readAlertEvaluation(env, siteId, setting.first_event_at, policy, at);
    const runId = await sha256Hex(JSON.stringify(["site-alert-run", siteId, generation, target]));
    const result = await env.DB.batch([
      env.DB.prepare(`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM site_alert_settings a JOIN sites s ON s.id=a.site_id
        WHERE a.site_id=? AND a.generation=? AND a.enabled=1 AND a.lease_token=? AND s.workspace_id=? AND s.deleted_at IS NULL)
        THEN 'true' ELSE 'site_alert_lease_lost' END)`).bind(siteId, generation, lease, setting.workspace_id),
      env.DB.prepare(`INSERT INTO site_alert_runs(id,site_id,workspace_id,generation,target_day,policy_json,evaluation_json,checked_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(site_id,generation,target_day) DO NOTHING`).bind(runId, siteId, setting.workspace_id, generation, target, JSON.stringify(policy), JSON.stringify(evaluation), at),
      env.DB.prepare(`INSERT INTO site_alert_mail_outbox(id,run_id,site_id,workspace_id,user_id,config_generation,subscription_generation,status,next_attempt_at,expires_at,created_at,updated_at)
        SELECT lower(hex(randomblob(16))),?,r.site_id,?,r.user_id,?,r.generation,?,?,?, ?,? FROM site_alert_recipients r
        JOIN sites s ON s.id=r.site_id
        WHERE s.workspace_id=? AND r.site_id=? AND ${activeAlertRecipientSql("r")} AND ?='low'
        ON CONFLICT(run_id,user_id,subscription_generation) DO NOTHING RETURNING id`)
        .bind(runId, setting.workspace_id, generation, alertMailConfigured(env) ? "queued" : "blocked", at, at + ALERT_DAY_MS, at, at, setting.workspace_id, siteId, evaluation.result),
      env.DB.prepare(`UPDATE site_alert_settings SET last_checked_day=?,next_check_at=?,lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE site_id=? AND generation=? AND lease_token=?`).bind(target, nextAlertCheck(at), at, siteId, generation, lease),
    ]);
    lease = null;
    const ids = result[2]!.results as { id: string }[];
    if (ids.length) await env.PIPELINE.sendBatch(ids.map(({ id }) => ({ body: { type: "send_site_alert", payload: { id } } })));
    console.log("[site_alert_check]", JSON.stringify({ checked: 1, low: evaluation.result === "low" ? 1 : 0, insufficient: evaluation.result === "insufficient" ? 1 : 0, queued: ids.length, failures: 0 }));
  } catch {
    console.error("[site_alert_check_failed]", JSON.stringify({ failures: 1 }));
    throw new Error("site_alert_check_failed");
  } finally {
    if (lease) await env.DB.prepare("UPDATE site_alert_settings SET lease_token=NULL,lease_until=NULL WHERE site_id=? AND generation=? AND lease_token=?").bind(siteId, generation, lease).run().catch(() => {});
  }
}

// Piggyback on the existing cleanup Queue: no new Cron scan or cloud resource.
export async function maintainSiteAlerts(env: Env): Promise<void> {
  const at = Date.now();
  try {
    const result = await env.DB.batch([
      env.DB.prepare(`UPDATE site_alert_mail_outbox SET status=CASE WHEN first_attempt_at IS NULL THEN 'expired' ELSE 'unknown' END,payload_enc=NULL,lease_token=NULL,error_code='delivery_expired',updated_at=?
        WHERE id IN(SELECT id FROM site_alert_mail_outbox WHERE status IN ('queued','blocked','failed','sending')
        AND (status<>'sending' OR last_attempt_at<?) AND (expires_at<=? OR first_attempt_at<=? OR first_attempt_at>?) ORDER BY created_at,id LIMIT ?)`)
        .bind(at, at - LEASE_MS, at, at - ALERT_DAY_MS + 60_000, at + 60_000, ALERT_CLEANUP_BATCH),
      env.DB.prepare(`UPDATE site_alert_mail_outbox SET status=CASE WHEN first_attempt_at IS NULL THEN 'cancelled' ELSE 'unknown' END,payload_enc=NULL,lease_token=NULL,error_code='context_changed',updated_at=?
        WHERE id IN(SELECT o.id FROM site_alert_mail_outbox o WHERE o.status IN ('queued','blocked','failed','sending')
        AND (o.status<>'sending' OR o.last_attempt_at<?) AND NOT (${alertAuthoritySql("o")}) ORDER BY o.created_at,o.id LIMIT ?)`)
        .bind(at, at - LEASE_MS, ALERT_CLEANUP_BATCH),
      env.DB.prepare("DELETE FROM site_alert_mail_outbox WHERE id IN(SELECT id FROM site_alert_mail_outbox WHERE created_at<? ORDER BY created_at,id LIMIT ?)").bind(at - ALERT_RETENTION_MS, ALERT_CLEANUP_BATCH),
      env.DB.prepare("DELETE FROM site_alert_runs WHERE id IN(SELECT id FROM site_alert_runs WHERE checked_at<? ORDER BY checked_at,id LIMIT ?)").bind(at - ALERT_RETENTION_MS, ALERT_CLEANUP_BATCH),
      env.DB.prepare(`UPDATE site_alert_settings SET next_check_at=? WHERE site_id IN(SELECT a.site_id FROM site_alert_settings a JOIN sites s ON s.id=a.site_id
        WHERE a.enabled=1 AND a.next_check_at<=? AND s.deleted_at IS NULL ORDER BY a.next_check_at,a.site_id LIMIT ?) RETURNING site_id,generation`)
        .bind(at + 15 * 60_000, at, ALERT_SITE_BATCH),
      env.DB.prepare(`UPDATE site_alert_mail_outbox SET last_enqueued_at=? WHERE id IN(SELECT id FROM site_alert_mail_outbox WHERE
        ((status IN ('queued','blocked','failed') AND next_attempt_at<=?) OR (status='sending' AND last_attempt_at<?)) AND expires_at>?
        AND (last_enqueued_at IS NULL OR last_enqueued_at<=?)
        ORDER BY next_attempt_at,id LIMIT ?) RETURNING id`).bind(at, at, at - LEASE_MS, at, at - 15 * 60_000, ALERT_MAIL_BATCH),
      env.DB.prepare(`SELECT (SELECT count(*) FROM site_alert_settings a JOIN sites s ON s.id=a.site_id WHERE a.enabled=1 AND a.next_check_at<=? AND s.deleted_at IS NULL) AS sites,
        (SELECT count(*) FROM site_alert_mail_outbox WHERE ((status IN ('queued','blocked','failed') AND next_attempt_at<=?) OR (status='sending' AND last_attempt_at<?)) AND expires_at>?
          AND (last_enqueued_at IS NULL OR last_enqueued_at<=?)) AS mails`).bind(at, at, at - LEASE_MS, at, at - 15 * 60_000),
      env.DB.prepare(`${invalidateAlertRecipientsSql()} AND (r.site_id,r.user_id) IN(SELECT stale.site_id,stale.user_id FROM site_alert_recipients stale
        WHERE stale.active=1 AND NOT (${activeAlertRecipientSql("stale")}) ORDER BY stale.updated_at,stale.site_id,stale.user_id LIMIT ?)`)
        .bind(at, ALERT_CLEANUP_BATCH),
    ]);
    const checks = result[4]!.results as { site_id: string; generation: string }[], mails = result[5]!.results as { id: string }[];
    const remaining = result[6]!.results[0] as { sites: number; mails: number };
    const messages = [...checks.map((row) => ({ body: { type: "check_site_alert", payload: { siteId: row.site_id, generation: row.generation } } })),
      ...mails.map(({ id }) => ({ body: { type: "send_site_alert", payload: { id } } }))];
    if (remaining.sites || remaining.mails) messages.push({ body: { type: "site_alert_maintenance", payload: {} } } as typeof messages[number]);
    if (messages.length) await env.PIPELINE.sendBatch(messages);
    console.log("[site_alert_maintenance]", JSON.stringify({ sitesQueued: checks.length, mailsQueued: mails.length, overdueSites: remaining.sites, overdueMails: remaining.mails, scrubbed: result[0]!.meta.changes + result[1]!.meta.changes, receiptsDeleted: result[2]!.meta.changes, runsDeleted: result[3]!.meta.changes, recipientsCancelled: result[7]!.meta.changes, failures: 0 }));
  } catch {
    console.error("[site_alert_maintenance_failed]", JSON.stringify({ failures: 1 }));
    throw new Error("site_alert_maintenance_failed");
  }
}
