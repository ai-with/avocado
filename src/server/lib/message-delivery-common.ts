import { z } from "zod";
import { hmacHex, safeEqual } from "./crypto";
import { ApiError } from "./errors";
import { nightRetryAt, type MessageKind, type Channel } from "../../shared/messaging";
import type { Auth } from "../types";

export const MESSAGE_DAY = 86_400_000;
export const MESSAGE_WINDOW = MESSAGE_DAY - 60_000;
export const MESSAGE_RECEIPT_RETENTION = 30 * MESSAGE_DAY;
export const MESSAGE_LEASE = 5 * 60_000;
export const MESSAGE_RETRY = 60_000;
export const MESSAGE_PAGE = 100;
export const terminalDelivery = (status: string) => ["accepted", "skipped", "failed", "unknown", "cancelled"].includes(status);
export type MessageRun = { id: string; workspace_id: string; source_kind: "broadcast" | "automation"; source_id: string; source_run_key: string; source_generation: string; authorization_generation: string; actor_id: string | null; trigger_lead_id: string | null; trigger_birth_revision: number | null; ref_id: string | null; request_fingerprint: string | null; status: string; channel: Channel; kind: MessageKind; due_at: number; snapshot_enc: string | null; enumeration_done: number; target_count: number; completed_count: number; eligible_count: number; lease_token: string | null; lease_until: number | null; created_at: number };
export type MessageDelivery = { id: string; run_id: string; workspace_id: string; lead_id: string | null; lead_birth_revision: number; lead_created_at: number; status: string; reason: string | null; next_attempt_at: number; last_enqueued_at: number | null; lease_token: string | null; lease_until: number | null; payload_enc: string | null; request_hash: string | null; provider_fingerprint: string | null; recipient_hmac: string | null; first_http_at: number | null; last_attempt_at: number | null; attempts: number; provider_id: string | null };
export const sqlAssertion = (condition: string) => `SELECT json(CASE WHEN ${condition} THEN 'true' ELSE 'message_context_changed' END)`;
export const actorSql = `EXISTS(SELECT 1 FROM sessions se JOIN users u ON u.id=se.user_id JOIN members m ON m.workspace_id=se.current_workspace_id AND m.user_id=u.id WHERE se.id=? AND se.user_id=? AND se.expires_at>? AND se.current_workspace_id=? AND u.phone_verified_at IS NOT NULL AND m.role IN('owner','editor'))`;
export const actorParams = (auth: Auth, workspaceId: string, at: number) => [auth.sessionId, auth.user.id, at, workspaceId] as const;
export function runAuthority(alias = "r") {
  return `EXISTS(SELECT 1 FROM workspaces w JOIN users u ON u.id=${alias}.actor_id JOIN members m ON m.user_id=u.id AND m.workspace_id=w.id WHERE w.id=${alias}.workspace_id AND u.phone_verified_at IS NOT NULL AND m.role IN('owner','editor')) AND
    ((${alias}.source_kind='broadcast' AND EXISTS(SELECT 1 FROM broadcasts b WHERE b.id=${alias}.source_id AND b.workspace_id=${alias}.workspace_id AND b.generation=${alias}.source_generation AND b.authorization_generation=${alias}.authorization_generation AND b.authorized_by=${alias}.actor_id AND b.authorization_revoked_at IS NULL AND b.active_run_id=${alias}.id AND b.status IN('scheduled','sending'))) OR
    (${alias}.source_kind='automation' AND EXISTS(SELECT 1 FROM automations a WHERE a.id=${alias}.source_id AND a.workspace_id=${alias}.workspace_id AND a.generation=${alias}.source_generation AND a.authorization_generation=${alias}.authorization_generation AND a.authorized_by=${alias}.actor_id AND a.authorization_revoked_at IS NULL AND a.enabled=1
      AND ((json_extract(a.target,'$.formId')=${alias}.ref_id AND EXISTS(SELECT 1 FROM forms f WHERE f.id=${alias}.ref_id AND f.workspace_id=a.workspace_id AND f.deleted_at IS NULL))
        OR (json_extract(a.target,'$.documentId')=${alias}.ref_id AND EXISTS(SELECT 1 FROM documents doc WHERE doc.id=${alias}.ref_id AND doc.workspace_id=a.workspace_id AND doc.deleted_at IS NULL))
        OR (EXISTS(SELECT 1 FROM guides g WHERE g.id=json_extract(a.target,'$.guideId') AND g.workspace_id=a.workspace_id)
          AND (EXISTS(SELECT 1 FROM forms f WHERE f.id=${alias}.ref_id AND f.workspace_id=a.workspace_id AND f.deleted_at IS NULL) OR EXISTS(SELECT 1 FROM documents doc WHERE doc.id=${alias}.ref_id AND doc.workspace_id=a.workspace_id AND doc.deleted_at IS NULL)))))))`;
}
export function deliveryAuthority(alias = "d") {
  return `EXISTS(SELECT 1 FROM message_runs r JOIN leads l ON l.id=${alias}.lead_id AND l.workspace_id=r.workspace_id JOIN lead_import_births b ON b.lead_id=l.id AND b.workspace_id=l.workspace_id WHERE r.id=${alias}.run_id AND r.workspace_id=${alias}.workspace_id AND r.status='ready' AND r.enumeration_done=1 AND ${runAuthority("r")} AND l.deleted_at IS NULL AND l.created_at=${alias}.lead_created_at AND b.revision=${alias}.lead_birth_revision)`;
}
// Same precedence as canSend, including the historical timestamp0 convention.
export function eligibilitySql(lead = "l", run = "r", connected = "0") {
  return `CASE WHEN coalesce(${lead}.unsubscribed_at,0)<>0 THEN 'unsubscribed' WHEN ${run}.channel='email' AND coalesce(${lead}.bounced_at,0)<>0 THEN 'bounced'
    WHEN ${run}.channel='alimtalk' AND (${lead}.phone IS NULL OR ${lead}.phone='') THEN 'no_phone'
    WHEN ${run}.channel='alimtalk' AND ${lead}.alimtalk_opt_in<>1 THEN 'no_alimtalk_consent'
    WHEN ${run}.channel='alimtalk' AND ${connected}=0 THEN 'alimtalk_not_connected'
    WHEN ${run}.channel='email' AND ${run}.kind='ad' AND ${lead}.marketing_opt_in<>1 THEN 'no_consent' ELSE 'eligible' END`;
}
export function messageFrom(env: Env): string | null {
  const value = env.EMAIL_FROM?.trim(); if (!value || /[\r\n]/.test(value)) return null;
  const address = value.match(/<([^<>]+)>$/)?.[1] ?? value;
  if (!z.email().safeParse(address).success) return null;
  const domain = address.split("@")[1]!.toLowerCase();
  if (["example.com", "example.org", "example.net", "resend.dev", "localhost"].some((d) => domain === d || domain.endsWith("." + d)) || /\.(invalid|example|test|localhost)$/.test(domain)) return null;
  return value;
}
export const messageConfigured = (env: Env) => Boolean(messageFrom(env) && env.RESEND_API_KEY?.trim() && env.TOKEN_ENC_KEY?.trim());
export const messageRecipientHmac = (key: string, id: string, email: string) => hmacHex(key, JSON.stringify(["message-delivery-recipient", id, email.trim().toLowerCase()]));
export const messageNight = (kind: MessageKind, at: number) => kind === "ad" ? nightRetryAt(at) : null;
export const messageCsrf = (env: Env, auth: Auth, ws: string) => hmacHex(env.TOKEN_ENC_KEY || auth.sessionId, JSON.stringify(["message-send", auth.user.id, auth.sessionId, ws]));
export async function requireMessageCsrf(env: Env, auth: Auth, ws: string, origin?: string, token?: string, expectedWorkspace?: string) {
  if (expectedWorkspace !== ws || origin !== new URL(env.APP_URL).origin || !token || !safeEqual(token, await messageCsrf(env, auth, ws))) throw new ApiError(403, "csrf_invalid", "로그인이나 워크스페이스가 바뀌었어요. 화면을 다시 열어 주세요.");
}
