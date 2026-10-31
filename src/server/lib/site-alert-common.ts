import { z } from "zod";
import type { Auth } from "../types";
import { ApiError } from "./errors";
import { hmacHex, safeEqual } from "./crypto";
import { DEFAULT_SITE_ALERT_POLICY, type SiteAlertPolicy } from "../../shared/site-alerts";
import { alertDay, evaluateSiteAlert, shiftAlertDay } from "./site-alert-policy";

export type AlertSettingsRow = { site_id: string; generation: string; enabled: number; metric: SiteAlertPolicy["metric"]; ratio_percent: number; minimum_average: number; confirmation_days: number; next_check_at: number; last_checked_day: string | null; lease_token: string | null; lease_until: number | null };
export type AlertRecipientRow = { generation: string; active: number; email_hmac: string | null; last_attempt_at: number | null; last_delivery_id: string | null };
export type AlertMailRow = { id: string; run_id: string; site_id: string; workspace_id: string; user_id: string; config_generation: string; subscription_generation: string; status: string; payload_enc: string | null; first_attempt_at: number | null; last_attempt_at: number | null; lease_token: string | null; next_attempt_at: number; expires_at: number; created_at: number };
export const alertPolicy = (row: AlertSettingsRow | null): SiteAlertPolicy => row ? { enabled: !!row.enabled, metric: row.metric, ratioPercent: row.ratio_percent, minimumAverage: row.minimum_average, confirmationDays: row.confirmation_days } : { ...DEFAULT_SITE_ALERT_POLICY };
export const storedAlertPolicy = (raw: string): SiteAlertPolicy => z.object({ enabled: z.boolean(), metric: z.enum(["pageviews", "conversions"]), ratioPercent: z.number().int().min(0).max(90), minimumAverage: z.number().int().min(1).max(1_000_000), confirmationDays: z.number().int().min(1).max(3) }).strict().parse(JSON.parse(raw));
export function alertFrom(env: Env): string | null {
  const from = env.EMAIL_FROM?.trim();
  if (!from || /[\r\n]/.test(from)) return null;
  const address = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  if (!z.email().safeParse(address).success) return null;
  const domain = address.split("@")[1]!.toLowerCase();
  if (["example.com", "example.net", "example.org", "resend.dev", "localhost"].some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`)) || /\.(?:invalid|example|test|localhost)$/.test(domain)) return null;
  return from;
}
export const alertMailConfigured = (env: Env) => Boolean(alertFrom(env) && env.RESEND_API_KEY?.trim() && env.TOKEN_ENC_KEY?.trim());
export const alertEmailHmac = (env: Env, siteId: string, userId: string, email: string) => hmacHex(env.TOKEN_ENC_KEY!, JSON.stringify(["site-alert-email", siteId, userId, email.trim().toLowerCase()]));
export const alertCsrf = (env: Env, auth: Auth) => hmacHex(env.TOKEN_ENC_KEY || auth.sessionId, JSON.stringify(["site-alert-csrf", auth.user.id, auth.sessionId]));
export async function requireAlertCsrf(env: Env, auth: Auth, origin: string | undefined, token: string | undefined) {
  if (origin !== new URL(env.APP_URL).origin || !token || !safeEqual(token, await alertCsrf(env, auth))) throw new ApiError(403, "csrf_invalid", "요청을 확인하지 못했어요. 화면을 새로 열어 주세요.");
}
export async function readAlertEvaluation(env: Env, siteId: string, firstEventAt: number | null, policy: SiteAlertPolicy, at: number) {
  const end = shiftAlertDay(alertDay(at), -1), start = shiftAlertDay(end, -6 - policy.confirmationDays);
  // Whitelisted aggregate column; no raw SDK/person/session/AE data is read.
  const column = policy.metric === "conversions" ? "conversions" : "pageviews";
  const rows = await env.DB.prepare(`SELECT day,sum(${column}) AS n FROM site_daily_stats WHERE site_id=? AND day>=? AND day<=? GROUP BY day ORDER BY day`).bind(siteId, start, end).all<{ day: string; n: number }>();
  return evaluateSiteAlert(policy, firstEventAt, rows.results, at);
}
// A subscription must still belong to an active site's verified owner/editor.
// Keep capacity, fanout, cleanup and delivery on the same eligibility predicate.
export function activeAlertRecipientSql(alias = "r") {
  return `${alias}.active=1 AND EXISTS(SELECT 1 FROM sites ar_site
    JOIN members ar_member ON ar_member.workspace_id=ar_site.workspace_id AND ar_member.user_id=${alias}.user_id
    JOIN users ar_user ON ar_user.id=ar_member.user_id
    WHERE ar_site.id=${alias}.site_id AND ar_site.deleted_at IS NULL AND ar_member.role IN ('owner','editor') AND ar_user.phone_verified_at IS NOT NULL)`;
}
export function invalidateAlertRecipientsSql() {
  return `UPDATE site_alert_recipients AS r SET active=0,generation=lower(hex(randomblob(18))),email_hmac=NULL,updated_at=?
    WHERE r.active=1 AND NOT (${activeAlertRecipientSql("r")})`;
}
// Re-evaluated in every mail claim and immediately before provider HTTP.
export function alertAuthoritySql(alias = "o", email = false) {
  return `EXISTS(SELECT 1 FROM sites s JOIN site_alert_settings a ON a.site_id=s.id
    JOIN site_alert_recipients r ON r.site_id=s.id AND r.user_id=${alias}.user_id
    JOIN users u ON u.id=r.user_id
    WHERE s.id=${alias}.site_id AND s.workspace_id=${alias}.workspace_id AND s.deleted_at IS NULL
    AND a.enabled=1 AND a.generation=${alias}.config_generation AND r.generation=${alias}.subscription_generation
    AND ${activeAlertRecipientSql("r")} ${email ? "AND lower(trim(u.email))=? AND r.email_hmac=?" : ""})`;
}
