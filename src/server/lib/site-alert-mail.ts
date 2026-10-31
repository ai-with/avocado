import { z } from "zod";
import { encryptToken, decryptToken } from "./crypto";
import { newToken, sha256Hex } from "./ids";
import { sendEmail } from "./email";
import { escapeHtml } from "./html";
import { ALERT_COOLDOWN_MS, ALERT_DAY_MS, alertDay, shiftAlertDay } from "./site-alert-policy";
import { alertAuthoritySql, alertEmailHmac, alertFrom, alertMailConfigured, readAlertEvaluation, storedAlertPolicy, type AlertMailRow } from "./site-alert-common";

const LEASE_MS = 5 * 60_000, RETRY_MS = 15 * 60_000, WINDOW_MS = ALERT_DAY_MS - 60_000;
const terminal = (status: string) => ["sent", "cancelled", "expired", "unknown"].includes(status);
const frozenSchema = z.object({ from: z.string().max(320), to: z.email(), subject: z.string().max(500), text: z.string().max(8000), html: z.string().max(12000), providerFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Frozen = z.infer<typeof frozenSchema>;
type Context = { site_name: string; first_event_at: number | null; email: string; email_hmac: string; last_attempt_at: number | null; last_delivery_id: string | null; policy_json: string; target_day: string };
const snapshotParams = (job: AlertMailRow) => [job.id, job.status, job.lease_token, job.first_attempt_at, job.payload_enc] as const;
async function close(env: Env, job: AlertMailRow, reason: string, ownedLease?: string, expired = false) {
  await env.DB.prepare(`UPDATE site_alert_mail_outbox SET status=CASE WHEN first_attempt_at IS NULL THEN ? ELSE 'unknown' END,
    payload_enc=NULL,lease_token=NULL,error_code=?,updated_at=? WHERE id=? AND ${ownedLease ? "status='sending' AND lease_token=?" : "status=? AND lease_token IS ? AND first_attempt_at IS ? AND payload_enc IS ?"}
    AND status NOT IN ('sent','cancelled','unknown','expired')`)
    .bind(expired ? "expired" : "cancelled", reason, Date.now(), ...(ownedLease ? [job.id, ownedLease] : snapshotParams(job))).run();
}
async function block(env: Env, job: AlertMailRow) {
  await env.DB.prepare(`UPDATE site_alert_mail_outbox SET status='blocked',error_code='sender_not_ready',lease_token=NULL,next_attempt_at=?,updated_at=?
    WHERE id=? AND status=? AND lease_token IS ? AND first_attempt_at IS ? AND payload_enc IS ?`)
    .bind(Date.now() + 60 * 60_000, Date.now(), ...snapshotParams(job)).run();
}
async function context(env: Env, job: AlertMailRow): Promise<Context | null> {
  return env.DB.prepare(`SELECT s.name AS site_name,s.first_event_at,u.email,r.email_hmac,r.last_attempt_at,r.last_delivery_id,run.policy_json,run.target_day
    FROM site_alert_mail_outbox o JOIN sites s ON s.id=o.site_id JOIN site_alert_recipients r ON r.site_id=s.id AND r.user_id=o.user_id
    JOIN users u ON u.id=o.user_id JOIN site_alert_runs run ON run.id=o.run_id AND run.site_id=s.id AND run.workspace_id=o.workspace_id AND run.generation=o.config_generation
    WHERE o.id=? AND ${alertAuthoritySql("o")}`).bind(job.id).first<Context>();
}
async function cancelBeforeHttp(env: Env, job: AlertMailRow, lease: string, current: Context, reason: string) {
  if (job.first_attempt_at !== null) return close(env, job, reason, lease);
  // This worker knows it has not started HTTP. Undo only its own still-owned
  // intent; a newer lease or an accepted attempt can never lose its cooldown.
  await env.DB.batch([
    env.DB.prepare(`UPDATE site_alert_recipients SET last_attempt_at=?,last_delivery_id=? WHERE site_id=? AND user_id=? AND last_delivery_id=?
      AND EXISTS(SELECT 1 FROM site_alert_mail_outbox WHERE id=? AND lease_token=? AND status='sending')`)
      .bind(current.last_attempt_at, current.last_delivery_id, job.site_id, job.user_id, job.id, job.id, lease),
    env.DB.prepare("UPDATE site_alert_mail_outbox SET status='cancelled',payload_enc=NULL,lease_token=NULL,first_attempt_at=NULL,last_attempt_at=NULL,error_code=?,updated_at=? WHERE id=? AND lease_token=? AND status='sending'")
      .bind(reason, Date.now(), job.id, lease),
  ]);
}

export async function sendSiteAlert(payload: unknown, env: Env): Promise<void> {
  if (!payload || typeof payload !== "object" || typeof (payload as { id?: unknown }).id !== "string" || (payload as { id: string }).id.length > 100) throw new Error("site_alert_mail_invalid");
  const id = (payload as { id: string }).id;
  let job: AlertMailRow | null = null, lease: string | null = null;
  try {
    job = await env.DB.prepare("SELECT * FROM site_alert_mail_outbox WHERE id=?").bind(id).first<AlertMailRow>();
    if (!job || terminal(job.status)) return;
    const at = Date.now();
    if (job.expires_at <= at || job.first_attempt_at !== null && (job.first_attempt_at <= at - WINDOW_MS || job.first_attempt_at > at + 60_000)) return close(env, job, "delivery_expired", undefined, true);
    if (job.status === "sending" && (job.last_attempt_at ?? 0) >= at - LEASE_MS || job.status !== "sending" && job.next_attempt_at > at) return;
    const current = await context(env, job);
    if (!current) return close(env, job, "context_changed");
    if (!alertMailConfigured(env)) return block(env, job);
    const email = current.email.trim().toLowerCase();
    if (!z.email().safeParse(email).success || current.email_hmac !== await alertEmailHmac(env, job.site_id, job.user_id, email)) return close(env, job, "email_changed");
    if (current.target_day !== shiftAlertDay(alertDay(at), -1)) return close(env, job, "stale_period");
    if (job.first_attempt_at === null && current.last_delivery_id !== job.id && current.last_attempt_at !== null && current.last_attempt_at > at - ALERT_COOLDOWN_MS) return close(env, job, "cooldown");
    // Fresh aggregate check before every provider attempt; retries keep their already frozen body.
    const policy = storedAlertPolicy(current.policy_json);
    const evaluation = await readAlertEvaluation(env, job.site_id, current.first_event_at, policy, at);
    if (evaluation.result !== "low") return close(env, job, "recovered");
    let frozen: Frozen;
    if (job.payload_enc) frozen = frozenSchema.parse(JSON.parse(await decryptToken(env.TOKEN_ENC_KEY!, job.payload_enc)));
    else {
      const label = policy.metric === "pageviews" ? "페이지뷰" : "전환 수";
      const url = new URL(`/dashboard/sites?siteId=${encodeURIComponent(job.site_id)}`, env.APP_URL).href;
      const subject = `[사이트 알림] ${current.site_name} ${label} 감소`.replace(/[\r\n]/g, " ");
      const text = `${current.site_name}의 수집된 ${label}가 줄었어요.\n확인 기간: ${evaluation.targetStart} ~ ${evaluation.targetDay} (KST)\n그전 7일 평균: ${(evaluation.baselineSum / 7).toFixed(1)}\n확인 기간 일별 수: ${evaluation.target.join(", ")}\n기준: 평균의 ${policy.ratioPercent}% 이하, 전주 같은 요일보다도 감소\n트래픽·동의 설정·수집 지연을 확인해 주세요. 장애를 확정하는 알림은 아니에요.\n${url}\n알림 받기 해제: 사이트의 급감 알림 설정`;
      frozen = frozenSchema.parse({ from: alertFrom(env)!, to: email, subject, text, html: `<p>${escapeHtml(current.site_name)}의 수집된 ${label}가 줄었어요.</p><p>확인 기간: ${evaluation.targetStart} ~ ${evaluation.targetDay} (KST)</p><p>그전 7일 평균: ${(evaluation.baselineSum / 7).toFixed(1)} · 일별 수: ${evaluation.target.join(", ")}</p><p>트래픽·동의 설정·수집 지연을 확인해 주세요. 장애 확정 알림은 아니에요.</p><p><a href="${escapeHtml(url)}">사이트와 알림 설정 확인</a></p>`, providerFingerprint: await sha256Hex(env.RESEND_API_KEY!) });
    }
    if (frozen.to !== email || frozen.from !== alertFrom(env) || frozen.providerFingerprint !== await sha256Hex(env.RESEND_API_KEY!)) return close(env, job, "sender_or_email_changed");
    const encrypted = job.payload_enc ?? await encryptToken(env.TOKEN_ENC_KEY!, JSON.stringify(frozen));
    lease = newToken(24);
    const claimed = await env.DB.batch([
      env.DB.prepare(`UPDATE site_alert_mail_outbox AS o SET status='sending',payload_enc=?,first_attempt_at=coalesce(first_attempt_at,?),last_attempt_at=?,lease_token=?,attempts=attempts+1,error_code=NULL,updated_at=?
        WHERE o.id=? AND o.status=? AND o.lease_token IS ? AND o.first_attempt_at IS ? AND o.payload_enc IS ?
        AND ((o.status='sending' AND o.last_attempt_at<?) OR (o.status IN ('queued','blocked','failed') AND o.next_attempt_at<=?))
        AND o.expires_at>? AND (o.first_attempt_at IS NULL OR (o.first_attempt_at>? AND o.first_attempt_at<=?))
        AND ${alertAuthoritySql("o", true)}
        AND EXISTS(SELECT 1 FROM site_alert_recipients r WHERE r.site_id=o.site_id AND r.user_id=o.user_id
          AND (r.last_delivery_id=o.id OR o.first_attempt_at IS NULL AND (r.last_attempt_at IS NULL OR r.last_attempt_at<=?))) RETURNING id`)
        .bind(encrypted, at, at, lease, at, ...snapshotParams(job), at - LEASE_MS, at, at, at - WINDOW_MS, at + 60_000, email, current.email_hmac, at - ALERT_COOLDOWN_MS),
      env.DB.prepare(`UPDATE site_alert_recipients SET last_attempt_at=CASE WHEN last_delivery_id=? THEN last_attempt_at ELSE ? END,last_delivery_id=?
        WHERE site_id=? AND user_id=? AND EXISTS(SELECT 1 FROM site_alert_mail_outbox WHERE id=? AND lease_token=? AND status='sending')`)
        .bind(job.id, job.first_attempt_at ?? at, job.id, job.site_id, job.user_id, job.id, lease),
    ]);
    if (!claimed[0]!.results.length) { lease = null; return close(env, job, "claim_not_eligible"); }
    const latest = await readAlertEvaluation(env, job.site_id, current.first_event_at, policy, Date.now());
    if (latest.targetDay !== current.target_day || latest.result !== "low") return cancelBeforeHttp(env, job, lease, current, "recovered");
    const readyAt = Date.now();
    const ready = await env.DB.prepare(`SELECT o.id FROM site_alert_mail_outbox o WHERE o.id=? AND o.status='sending' AND o.lease_token=?
      AND o.expires_at>? AND o.first_attempt_at>? AND o.first_attempt_at<=? AND ${alertAuthoritySql("o", true)}`)
      .bind(job.id, lease, readyAt, readyAt - WINDOW_MS, readyAt + 60_000, email, current.email_hmac).first();
    if (!ready || shiftAlertDay(alertDay(readyAt), -1) !== current.target_day) return cancelBeforeHttp(env, job, lease, current, "context_changed");
    const response = await sendEmail(env, { to: frozen.to, subject: frozen.subject, text: frozen.text, html: frozen.html }, { from: frozen.from, idempotencyKey: `site-alert/${job.id}`, timeoutMs: 10_000, logProviderErrors: false });
    if (!response.delivered) throw new Error("site_alert_provider_failed");
    await env.DB.prepare("UPDATE site_alert_mail_outbox SET status='sent',provider_id=?,payload_enc=NULL,lease_token=NULL,error_code=NULL,updated_at=? WHERE id=? AND lease_token=? AND status='sending'")
      .bind(response.id, Date.now(), job.id, lease).run();
    console.log("[site_alert_mail]", JSON.stringify({ sent: 1, failures: 0 }));
  } catch {
    if (job && lease) await env.DB.prepare("UPDATE site_alert_mail_outbox SET status='failed',lease_token=NULL,error_code='provider_unavailable',next_attempt_at=?,updated_at=? WHERE id=? AND lease_token=? AND status='sending'")
      .bind(Date.now() + RETRY_MS, Date.now(), job.id, lease).run().catch(() => {});
    console.error("[site_alert_mail_failed]", JSON.stringify({ failures: 1 }));
    throw new Error("site_alert_mail_failed");
  }
}
