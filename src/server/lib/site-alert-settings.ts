import type { Auth } from "../types";
import { ApiError } from "./errors";
import { newToken } from "./ids";
import { ALERT_COOLDOWN_MS, nextAlertCheck } from "./site-alert-policy";
import { activeAlertRecipientSql, invalidateAlertRecipientsSql, alertCsrf, alertEmailHmac, alertMailConfigured, alertPolicy, type AlertRecipientRow, type AlertSettingsRow } from "./site-alert-common";
import type { SiteAlertPolicy, SiteAlertStatus } from "../../shared/site-alerts";

export type AlertSave = { settings?: SiteAlertPolicy; subscribed: boolean; expectedGeneration: string | null; expectedSubscriptionGeneration: string | null };
export async function ownedAlertSite(env: Env, workspaceId: string, siteId: string) {
  const site = await env.DB.prepare("SELECT id,workspace_id,name,first_event_at FROM sites WHERE id=? AND workspace_id=? AND deleted_at IS NULL").bind(siteId, workspaceId).first<{ id: string; workspace_id: string; name: string; first_event_at: number | null }>();
  if (!site) throw new ApiError(404, "site_not_found", "사이트를 찾을 수 없어요.");
  return site;
}
async function configAndRecipient(env: Env, siteId: string, userId: string) {
  const rows = await env.DB.batch([
    env.DB.prepare("SELECT * FROM site_alert_settings WHERE site_id=?").bind(siteId),
    env.DB.prepare("SELECT * FROM site_alert_recipients WHERE site_id=? AND user_id=?").bind(siteId, userId),
  ]);
  return { settings: (rows[0]!.results[0] as AlertSettingsRow | undefined) ?? null, recipient: (rows[1]!.results[0] as AlertRecipientRow | undefined) ?? null };
}
export async function siteAlertStatus(env: Env, auth: Auth, workspaceId: string, siteId: string): Promise<SiteAlertStatus> {
  await ownedAlertSite(env, workspaceId, siteId);
  const { settings, recipient } = await configAndRecipient(env, siteId, auth.user.id);
  const recent = await env.DB.batch([
    env.DB.prepare("SELECT evaluation_json,checked_at FROM site_alert_runs WHERE site_id=? AND workspace_id=? AND generation=? ORDER BY checked_at DESC,id LIMIT 1").bind(siteId, workspaceId, settings?.generation ?? ""),
    env.DB.prepare("SELECT status,error_code,updated_at FROM site_alert_mail_outbox WHERE site_id=? AND workspace_id=? AND user_id=? ORDER BY created_at DESC,id LIMIT 1").bind(siteId, workspaceId, auth.user.id),
  ]);
  const run = recent[0]!.results[0] as { evaluation_json: string; checked_at: number } | undefined;
  const mail = recent[1]!.results[0] as { status: string; error_code: string | null; updated_at: number } | undefined;
  const eligible = auth.role === "owner" || auth.role === "editor";
  return { policy: alertPolicy(settings), generation: settings?.generation ?? null, subscriptionGeneration: recipient?.generation ?? null,
    subscribed: !!recipient?.active, eligible, canEdit: eligible, mailConfigured: alertMailConfigured(env), csrfToken: await alertCsrf(env, auth), email: auth.user.email,
    cooldownUntil: recipient?.last_attempt_at === null || recipient?.last_attempt_at === undefined ? null : recipient.last_attempt_at + ALERT_COOLDOWN_MS,
    lastCheck: run ? { ...JSON.parse(run.evaluation_json), checkedAt: run.checked_at } : null,
    lastMail: mail ? { status: mail.status, errorCode: mail.error_code, at: mail.updated_at } : null };
}
export async function saveSiteAlert(env: Env, auth: Auth, workspaceId: string, siteId: string, input: AlertSave) {
  await ownedAlertSite(env, workspaceId, siteId);
  const eligible = auth.role === "owner" || auth.role === "editor";
  if ((input.settings || input.subscribed) && !eligible) throw new ApiError(403, "forbidden", "감지 설정과 알림 받기는 소유자·편집자만 사용할 수 있어요.");
  if (input.subscribed && !env.TOKEN_ENC_KEY?.trim()) throw new ApiError(503, "alert_key_missing", "알림 보안 설정을 준비하고 있어요. 받기 해제는 사용할 수 있어요.");
  const { settings, recipient } = await configAndRecipient(env, siteId, auth.user.id);
  if ((settings?.generation ?? null) !== input.expectedGeneration || (recipient?.generation ?? null) !== input.expectedSubscriptionGeneration) throw new ApiError(409, "alert_changed", "설정이 바뀌었어요. 다시 열어 확인해 주세요.");
  const at = Date.now(), oldPolicy = alertPolicy(settings), policy = input.settings ?? oldPolicy;
  const changed = !!input.settings && JSON.stringify(policy) !== JSON.stringify(oldPolicy);
  const generation = changed || !settings ? newToken(18) : settings.generation;
  const email = auth.user.email.trim().toLowerCase(), fingerprint = input.subscribed ? await alertEmailHmac(env, siteId, auth.user.id, email) : null;
  const subGeneration = !recipient || !!recipient.active !== input.subscribed || recipient.email_hmac !== fingerprint ? newToken(18) : recipient.generation;
  const needsEditor = !!input.settings || input.subscribed;
  const actor = `EXISTS(SELECT 1 FROM sessions se JOIN users u ON u.id=se.user_id JOIN members m ON m.user_id=u.id
    WHERE se.id=? AND se.user_id=? AND se.expires_at>? AND se.current_workspace_id=? AND m.workspace_id=?
    AND u.phone_verified_at IS NOT NULL AND lower(trim(u.email))=? ${needsEditor ? "AND m.role IN ('owner','editor')" : ""})`;
  const statements = [env.DB.prepare(`SELECT json(CASE WHEN ${actor}
    AND EXISTS(SELECT 1 FROM sites WHERE id=? AND workspace_id=? AND deleted_at IS NULL)
    AND ((? IS NULL AND NOT EXISTS(SELECT 1 FROM site_alert_settings WHERE site_id=?)) OR EXISTS(SELECT 1 FROM site_alert_settings WHERE site_id=? AND generation=?))
    AND ((? IS NULL AND NOT EXISTS(SELECT 1 FROM site_alert_recipients WHERE site_id=? AND user_id=?)) OR EXISTS(SELECT 1 FROM site_alert_recipients WHERE site_id=? AND user_id=? AND generation=?))
    AND (?=0 OR (SELECT count(*) FROM site_alert_recipients r WHERE r.site_id=? AND ${activeAlertRecipientSql("r")})<20 OR EXISTS(SELECT 1 FROM site_alert_recipients r WHERE r.site_id=? AND r.user_id=? AND ${activeAlertRecipientSql("r")}))
    THEN 'true' ELSE 'site_alert_context_changed' END)`)
    .bind(auth.sessionId, auth.user.id, at, workspaceId, workspaceId, email, siteId, workspaceId,
      input.expectedGeneration, siteId, siteId, input.expectedGeneration,
      input.expectedSubscriptionGeneration, siteId, auth.user.id, siteId, auth.user.id, input.expectedSubscriptionGeneration,
      input.subscribed ? 1 : 0, siteId, siteId, auth.user.id)];
  // Repair stale subscriptions in the same transaction as the guarded save.
  // Current valid subscribers and every cooldown field remain unchanged.
  statements.push(env.DB.prepare(`${invalidateAlertRecipientsSql()} AND r.site_id=?`).bind(at, siteId));
  if (input.settings) statements.push(env.DB.prepare(`INSERT INTO site_alert_settings(site_id,generation,enabled,metric,ratio_percent,minimum_average,confirmation_days,next_check_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET
    last_checked_day=CASE WHEN generation=excluded.generation THEN last_checked_day ELSE NULL END,
    lease_token=CASE WHEN generation=excluded.generation THEN lease_token ELSE NULL END,
    lease_until=CASE WHEN generation=excluded.generation THEN lease_until ELSE NULL END,
    next_check_at=CASE WHEN generation=excluded.generation THEN next_check_at ELSE excluded.next_check_at END,
    generation=excluded.generation,enabled=excluded.enabled,metric=excluded.metric,ratio_percent=excluded.ratio_percent,minimum_average=excluded.minimum_average,confirmation_days=excluded.confirmation_days,updated_at=excluded.updated_at`)
    .bind(siteId, generation, policy.enabled ? 1 : 0, policy.metric, policy.ratioPercent, policy.minimumAverage, policy.confirmationDays, nextAlertCheck(at, true), at, at));
  statements.push(env.DB.prepare(`INSERT INTO site_alert_recipients(site_id,user_id,generation,active,email_hmac,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(site_id,user_id) DO UPDATE SET generation=excluded.generation,active=excluded.active,email_hmac=excluded.email_hmac,updated_at=excluded.updated_at`)
    .bind(siteId, auth.user.id, subGeneration, input.subscribed ? 1 : 0, fingerprint, at, at));
  try { await env.DB.batch(statements); }
  catch { throw new ApiError(409, "alert_changed", "설정이나 권한이 바뀌었어요. 화면을 다시 열어 주세요."); }
}
