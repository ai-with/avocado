import { getDb } from "../db";
import type { Auth } from "../types";
import { ApiError } from "./errors";
import { newToken, sha256Hex } from "./ids";
import { encryptToken } from "./crypto";
import { audiencePredicate, normalizeRules, readRuleGroups } from "./lead-query";
import { productionMessagePolicy, requireMessagePolicy, type MessagePolicy, type PolicyContext } from "./message-policy";
import { actorParams, actorSql, eligibilitySql, MESSAGE_LEASE, MESSAGE_PAGE, runAuthority, sqlAssertion, type MessageRun } from "./message-delivery-common";
import { createMessageSender } from "./message-sender";
import { sendQueuedEmail, type QueuedEmailProvider } from "./message-provider";
import type { Audience, MessageTemplate, Trigger } from "../../shared/messaging";

type Source = { id: string; workspace_id: string; generation: string; authorized_by: string | null; authorization_generation: string; authorization_revoked_at: number | null; channel: "email" | "alimtalk"; kind: "info" | "ad"; template: string; audience?: string };
export type MessageSnapshot = { template: MessageTemplate; senderName: string; senderContact: string; groups: { id: string; rules: ReturnType<typeof normalizeRules> }[]; tags: string[] };
const payloadId = (value: unknown) => {
  const id = value && typeof value === "object" ? (value as { id?: unknown }).id : null;
  if (typeof id !== "string" || !id || id.length > 100) throw new Error("message_job_invalid");
  return id;
};
const context = (run: MessageRun, phase: PolicyContext["phase"], deliveryId?: string): PolicyContext => ({ workspaceId: run.workspace_id, actorId: run.actor_id ?? "", sourceKind: run.source_kind, sourceId: run.source_id, runId: run.id, phase, ...(deliveryId && { deliveryId }) });
export function createMessageEngine(policy: MessagePolicy = productionMessagePolicy, provider: QueuedEmailProvider = sendQueuedEmail) {
  const sender = createMessageSender(policy, provider);
  async function requestBroadcast(env: Env, auth: Auth, workspaceId: string, id: string, input: { requestId: string; generation: string; scheduledAt: number | null }) {
    const at = Date.now(), fingerprint = await sha256Hex(JSON.stringify([id, input.generation, input.scheduledAt]));
    const existing = await env.DB.prepare(`SELECT r.* FROM message_runs r WHERE r.id=? AND r.workspace_id=? AND r.actor_id=? AND ${actorSql}`)
      .bind(input.requestId, workspaceId, auth.user.id, ...actorParams(auth, workspaceId, at)).first<MessageRun>();
    if (existing) { if (existing.request_fingerprint !== fingerprint) throw new ApiError(409, "message_request_reused", "같은 요청의 발송 내용이 달라요."); return { id: existing.id, status: existing.status }; }
    requireMessagePolicy(policy);
    const authorization = newToken(18), idRun = input.requestId;
    const source = await env.DB.prepare("SELECT * FROM broadcasts WHERE id=? AND workspace_id=? AND status='draft' AND generation=?").bind(id, workspaceId, input.generation).first<Source>();
    if (!source) throw new ApiError(409, "message_changed", "발송 상태가 바뀌었어요. 다시 열어 주세요.");
    const due = input.scheduledAt && input.scheduledAt > at + 60_000 ? input.scheduledAt : at;
    const condition = policy.condition({ workspaceId, actorId: auth.user.id, sourceKind: "broadcast", sourceId: id, runId: idRun, phase: "authorize" });
    try { await env.DB.batch([
      env.DB.prepare(sqlAssertion(`${actorSql} AND EXISTS(SELECT 1 FROM broadcasts WHERE id=? AND workspace_id=? AND status='draft' AND generation=?) AND NOT EXISTS(SELECT 1 FROM message_runs WHERE id=?) AND (${condition.sql})`))
        .bind(...actorParams(auth, workspaceId, Date.now()), id, workspaceId, input.generation, idRun, ...condition.params),
      env.DB.prepare(`INSERT INTO message_runs(id,workspace_id,source_kind,source_id,source_run_key,source_generation,authorization_generation,actor_id,status,channel,kind,due_at,request_fingerprint,created_at,updated_at)
        VALUES(?,?,'broadcast',?,?,?,?,?,'scheduled',?,?,?,?,?,?)`)
        .bind(idRun, workspaceId, id, idRun, source.generation, authorization, auth.user.id, source.channel, source.kind, due, fingerprint, at, at),
      env.DB.prepare("UPDATE broadcasts SET status='scheduled',scheduled_at=?,authorized_by=?,authorization_generation=?,authorization_revoked_at=NULL,active_run_id=?,dispatch_token=NULL,delivery_state='scheduled',updated_at=? WHERE id=? AND generation=?")
        .bind(due, auth.user.id, authorization, idRun, at, id, source.generation),
    ]); } catch {
      const found = await env.DB.prepare(`SELECT id,request_fingerprint FROM message_runs WHERE id=? AND workspace_id=? AND actor_id=? AND ${actorSql}`).bind(idRun, workspaceId, auth.user.id, ...actorParams(auth, workspaceId, Date.now())).first<{ id: string; request_fingerprint: string }>();
      if (found?.request_fingerprint !== fingerprint) throw new ApiError(409, "message_changed", "발송 권한이나 상태가 바뀌었어요. 다시 확인해 주세요.");
    }
    if (due <= at) { try { await env.PIPELINE.sendBatch([{ body: { type: "prepare_message_run", payload: { id: idRun } } }]); } catch { /* Durable discovery retries the same run. */ } }
    return { id: idRun, status: "scheduled" };
  }
  async function cancelBroadcast(env: Env, auth: Auth, workspaceId: string, id: string, generation: string) {
    const at = Date.now(), next = newToken(18);
    try { await env.DB.batch([
      env.DB.prepare(sqlAssertion(`${actorSql} AND EXISTS(SELECT 1 FROM broadcasts WHERE id=? AND workspace_id=? AND generation=? AND status IN('scheduled','sending'))`)).bind(...actorParams(auth, workspaceId, at), id, workspaceId, generation),
      env.DB.prepare("UPDATE broadcasts SET status='draft',generation=?,authorization_generation=?,authorization_revoked_at=?,delivery_state='cancelled',scheduled_at=NULL,updated_at=? WHERE id=? AND workspace_id=? AND generation=?")
        .bind(next, newToken(18), at, at, id, workspaceId, generation),
      env.DB.prepare("UPDATE message_runs SET status='cancelled',snapshot_enc=NULL,error_code='source_changed',updated_at=? WHERE workspace_id=? AND source_kind='broadcast' AND source_id=? AND source_generation=? AND status IN('scheduled','preparing','ready','blocked')").bind(at, workspaceId, id, generation),
      env.DB.prepare(`UPDATE message_deliveries SET status=CASE WHEN first_http_at IS NULL THEN 'cancelled' ELSE 'unknown' END,reason='source_changed',payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE run_id IN(SELECT id FROM message_runs WHERE workspace_id=? AND source_kind='broadcast' AND source_id=? AND source_generation=?) AND status NOT IN('accepted','skipped','failed','unknown','cancelled')`).bind(at, workspaceId, id, generation),
    ]); } catch { throw new ApiError(409, "message_changed", "발송 상태가 바뀌었어요. 다시 확인해 주세요."); }
    return { generation: next };
  }
  async function enqueueAutomation(db: ReturnType<typeof getDb>, event: { workspaceId: string; trigger: Trigger; leadId: string; ref: { id: string; guideId: string | null } }) {
    const at = Date.now();
    try { await db.$client.prepare(`INSERT INTO message_runs(id,workspace_id,source_kind,source_id,source_run_key,source_generation,authorization_generation,actor_id,trigger_lead_id,trigger_birth_revision,ref_id,status,channel,kind,due_at,created_at,updated_at)
      SELECT lower(hex(randomblob(16))),a.workspace_id,'automation',a.id,json_array('automation',a.id,l.id,?),a.generation,a.authorization_generation,a.authorized_by,l.id,b.revision,?,'scheduled',a.channel,a.kind,?+a.delay_minutes*60000,?,?
      FROM automations a JOIN leads l ON l.id=? AND l.workspace_id=a.workspace_id AND l.deleted_at IS NULL JOIN lead_import_births b ON b.lead_id=l.id AND b.workspace_id=l.workspace_id
      JOIN users u ON u.id=a.authorized_by JOIN members m ON m.workspace_id=a.workspace_id AND m.user_id=u.id
      WHERE a.workspace_id=? AND a.trigger=? AND a.enabled=1 AND a.generation<>'' AND a.authorization_generation<>'' AND a.authorization_revoked_at IS NULL AND u.phone_verified_at IS NOT NULL AND m.role IN('owner','editor')
      AND ((?='form_submitted' AND EXISTS(SELECT 1 FROM forms f WHERE f.id=? AND f.workspace_id=a.workspace_id AND f.deleted_at IS NULL)) OR (?<>'form_submitted' AND EXISTS(SELECT 1 FROM documents doc WHERE doc.id=? AND doc.workspace_id=a.workspace_id AND doc.deleted_at IS NULL)))
      AND (json_extract(a.target,'$.formId')=? OR json_extract(a.target,'$.documentId')=? OR (? IS NOT NULL AND json_extract(a.target,'$.guideId')=?))
      AND NOT EXISTS(SELECT 1 FROM automation_runs old WHERE old.automation_id=a.id AND old.lead_id=l.id AND old.ref_id=?)
      ON CONFLICT(source_kind,source_run_key) DO NOTHING`)
      .bind(event.ref.id, event.ref.id, at, at, at, event.leadId, event.workspaceId, event.trigger, event.trigger, event.ref.id, event.trigger, event.ref.id, event.ref.id, event.ref.id, event.ref.guideId, event.ref.guideId, event.ref.id).run(); }
    catch { throw new Error("message_automation_enqueue_failed"); }
  }
  async function prepare(payload: unknown, env: Env) {
    const id = payloadId(payload), at = Date.now(); let lease: string | null = null;
    try {
      const run = await env.DB.prepare("SELECT * FROM message_runs WHERE id=?").bind(id).first<MessageRun>();
      if (!run || !["scheduled", "preparing"].includes(run.status) || run.due_at > at || run.enumeration_done) return;
      if (!policy.configured) { await env.DB.prepare("UPDATE message_runs SET status='blocked',error_code='send_policy_unconfigured' WHERE id=? AND status IN('scheduled','preparing')").bind(id).run(); return; }
      lease = newToken(24);
      const claimed = await env.DB.prepare(`UPDATE message_runs AS r SET status='preparing',lease_token=?,lease_until=?,updated_at=? WHERE id=? AND status IN('scheduled','preparing') AND enumeration_done=0 AND due_at<=? AND (lease_until IS NULL OR lease_until<=?) AND ${runAuthority()} RETURNING id`)
        .bind(lease, at + MESSAGE_LEASE, at, id, at, at).first();
      if (!claimed) { lease = null; return; }
      const table = run.source_kind === "broadcast" ? "broadcasts" : "automations";
      const source = await env.DB.prepare(`SELECT template${run.source_kind === "broadcast" ? ",audience" : ""} FROM ${table} WHERE id=? AND workspace_id=? AND generation=?`)
        .bind(run.source_id, run.workspace_id, run.source_generation).first<{ template: string; audience?: string }>();
      if (!source) throw new Error("source_changed");
      const audience: Audience = run.source_kind === "broadcast" ? JSON.parse(source.audience!) as Audience : { groupIds: [], tagIds: [] };
      const ids = [...new Set(audience.groupIds)], tags = [...new Set(audience.tagIds)];
      const groups = await readRuleGroups(getDb(env.DB), run.workspace_id, ids, true);
      if (groups.length !== ids.length) throw new Error("audience_changed");
      const ownership = await env.DB.prepare("SELECT count(*) AS n FROM lead_tags WHERE workspace_id=? AND id IN(SELECT value FROM json_each(?))").bind(run.workspace_id, JSON.stringify(tags)).first<{ n: number }>();
      if ((ownership?.n ?? 0) !== tags.length) throw new Error("audience_changed");
      const senderInfo = await env.DB.prepare("SELECT name,sender_name,sender_contact FROM workspaces WHERE id=?").bind(run.workspace_id).first<{ name: string; sender_name: string | null; sender_contact: string | null }>();
      const snapshot: MessageSnapshot = { template: JSON.parse(source.template) as MessageTemplate, senderName: senderInfo?.sender_name || senderInfo?.name || "", senderContact: senderInfo?.sender_contact || "", groups: groups.map((g) => ({ id: g.id, rules: normalizeRules(g.rules) })), tags };
      const raw = JSON.stringify(snapshot); if (new TextEncoder().encode(raw).byteLength > 1_000_000 || !env.TOKEN_ENC_KEY?.trim()) throw new Error("snapshot_unavailable");
      const encrypted = await encryptToken(env.TOKEN_ENC_KEY, raw), normalized = JSON.stringify(snapshot.groups), proof = JSON.stringify(groups.map((g) => ({ id: g.id, rules: g.rawRules })));
      const condition = policy.condition(context(run, "authorize"));
      const eligible = eligibilitySql("l", "r"); // Alimtalk adapter remains disconnected.
      const selection = run.source_kind === "broadcast" ? audiencePredicate("ctx.groups", "ctx.tags") : "l.id=r.trigger_lead_id AND b.revision=r.trigger_birth_revision";
      await env.DB.batch([
        env.DB.prepare(sqlAssertion(`EXISTS(SELECT 1 FROM message_runs r WHERE r.id=? AND r.lease_token=? AND r.status='preparing' AND r.enumeration_done=0 AND ${runAuthority()})
          AND NOT EXISTS(SELECT 1 FROM json_each(?) p LEFT JOIN lead_groups g ON g.id=json_extract(p.value,'$.id') AND g.workspace_id=? WHERE g.id IS NULL OR g.rules IS NOT json_extract(p.value,'$.rules'))
          AND (SELECT count(*) FROM lead_tags WHERE workspace_id=? AND id IN(SELECT value FROM json_each(?)))=? AND (${condition.sql})`))
          .bind(id, lease, proof, run.workspace_id, run.workspace_id, JSON.stringify(tags), tags.length, ...condition.params),
        env.DB.prepare(`WITH ctx(groups,tags) AS(VALUES(?,?)) INSERT INTO message_deliveries(id,run_id,workspace_id,lead_id,lead_birth_revision,lead_created_at,status,reason,next_attempt_at,created_at,updated_at)
          SELECT lower(hex(randomblob(16))),r.id,r.workspace_id,l.id,b.revision,l.created_at,CASE WHEN ${eligible}='eligible' THEN 'queued' ELSE 'skipped' END,CASE WHEN ${eligible}='eligible' THEN NULL ELSE ${eligible} END,?,?,?
          FROM ctx CROSS JOIN message_runs r CROSS JOIN leads l JOIN lead_import_births b ON b.lead_id=l.id AND b.workspace_id=l.workspace_id
          WHERE r.id=? AND r.lease_token=? AND r.status='preparing' AND r.enumeration_done=0 AND l.workspace_id=r.workspace_id AND l.deleted_at IS NULL AND ${selection}
          ON CONFLICT(run_id,lead_id,lead_birth_revision) DO NOTHING`).bind(normalized, JSON.stringify(tags), at, at, at, id, lease),
        ...(run.source_kind === "broadcast" ? [env.DB.prepare("UPDATE broadcasts SET status='sending',dispatch_token=?,delivery_state='ready' WHERE id=? AND workspace_id=? AND active_run_id=? AND generation=?").bind(lease, run.source_id, run.workspace_id, id, run.source_generation)] : []),
        env.DB.prepare(`UPDATE message_runs SET snapshot_enc=?,eligible_count=(SELECT count(*) FROM message_deliveries WHERE run_id=? AND status='queued'),enumeration_done=1,status=CASE WHEN target_count=completed_count THEN 'completed' ELSE 'ready' END,lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=? WHERE id=? AND lease_token=? AND status='preparing'`)
          .bind(encrypted, id, at, id, lease),
      ]);
      lease = null;
      try { await env.PIPELINE.sendBatch([{ body: { type: "dispatch_messages", payload: {} } }]); } catch { /* Durable due delivery discovery. */ }
    } catch { throw new Error("message_prepare_failed"); }
    finally { if (lease) await env.DB.prepare("UPDATE message_runs SET status='scheduled',lease_token=NULL,lease_until=NULL,next_enqueue_at=?,error_code='prepare_unavailable' WHERE id=? AND lease_token=? AND status='preparing'").bind(Date.now() + 60_000, id, lease).run().catch(() => {}); }
  }
  async function dispatch(_payload: unknown, env: Env) {
    if (!policy.configured) return;
    try {
      const at = Date.now();
      const result = await env.DB.batch([
        env.DB.prepare(`UPDATE message_deliveries AS d SET status=CASE WHEN first_http_at IS NULL THEN 'cancelled' ELSE 'unknown' END,reason='source_changed',payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL,updated_at=?
          WHERE id IN(SELECT d.id FROM message_deliveries d WHERE d.status IN('queued','deferred','retry','claimed','sending','blocked') AND (d.lease_until IS NULL OR d.lease_until<=?) AND NOT EXISTS(SELECT 1 FROM message_runs r WHERE r.id=d.run_id AND r.status='ready' AND ${runAuthority()}) ORDER BY d.created_at,d.id LIMIT ?)`)
          .bind(at, at, MESSAGE_PAGE),
        env.DB.prepare(`UPDATE message_deliveries SET last_enqueued_at=? WHERE id IN(SELECT d.id FROM message_deliveries d JOIN message_runs r ON r.id=d.run_id
          WHERE r.status='ready' AND d.status IN('queued','deferred','retry','claimed','sending','blocked') AND coalesce(d.reason,'') NOT IN('send_policy_denied','send_policy_unconfigured') AND d.next_attempt_at<=? AND (d.lease_until IS NULL OR d.lease_until<=?) AND (d.last_enqueued_at IS NULL OR d.last_enqueued_at<=?)
          ORDER BY d.next_attempt_at,d.id LIMIT ?) RETURNING id`).bind(at, at, at, at - 60_000, MESSAGE_PAGE),
      ]);
      const rows = result[1]!.results as { id: string }[];
      if (rows.length) await env.PIPELINE.sendBatch(rows.map(({ id }) => ({ body: { type: "send_message_delivery", payload: { id } } })));
      if (rows.length === MESSAGE_PAGE) await env.PIPELINE.sendBatch([{ body: { type: "dispatch_messages", payload: {} } }]);
    } catch { throw new Error("message_dispatch_failed"); }
  }
  async function maintain(_payload: unknown, env: Env) {
    const at = Date.now();
    try {
      await sender.cleanup(env);
      if (!policy.configured) return;
      const due = await env.DB.prepare(`UPDATE message_runs SET next_enqueue_at=? WHERE id IN(SELECT r.id FROM message_runs r WHERE r.status IN('scheduled','preparing') AND r.due_at<=? AND r.next_enqueue_at<=? AND (r.lease_until IS NULL OR r.lease_until<=?) AND ${runAuthority()} ORDER BY r.next_enqueue_at,r.id LIMIT 50) RETURNING id`)
        .bind(at + 60_000, at, at, at).all<{ id: string }>();
      const jobs = due.results.map(({ id }) => ({ body: { type: "prepare_message_run", payload: { id } } }));
      await env.PIPELINE.sendBatch([...jobs, { body: { type: "dispatch_messages", payload: {} } }]);
      if (jobs.length === 50) await env.PIPELINE.sendBatch([{ body: { type: "message_maintenance", payload: {} } }]);
    } catch { throw new Error("message_maintenance_failed"); }
  }
  return { requestBroadcast, cancelBroadcast, enqueueAutomation, prepare, dispatch, maintain, send: sender.send, assertPolicy: () => requireMessagePolicy(policy), policyConfigured: policy.configured };
}
export const messageEngine = createMessageEngine();
// Cron never executes SMTP or loops recipients; one bounded Queue message only.
export async function enqueueMessageMaintenance(env: Env) { await env.PIPELINE.sendBatch([{ body: { type: "message_maintenance", payload: {} } }]); }
