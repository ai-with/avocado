import { z } from "zod";
import { encryptToken, decryptToken } from "./crypto";
import { newToken, sha256Hex } from "./ids";
import { isEmailTemplate, renderEmail, VARIABLES, type EmailTemplate, type Vars } from "../../shared/messaging";
import { pendingBounceStatements } from "./message-bounce";
import { deliveryAuthority, eligibilitySql, messageConfigured, messageFrom, messageNight, messageRecipientHmac, MESSAGE_LEASE, MESSAGE_PAGE, MESSAGE_RECEIPT_RETENTION, MESSAGE_RETRY, MESSAGE_WINDOW, sqlAssertion, terminalDelivery, type MessageDelivery, type MessageRun } from "./message-delivery-common";
import type { MessagePolicy } from "./message-policy";
import type { QueuedEmailProvider } from "./message-provider";
import type { MessageSnapshot } from "./message-engine";

const frozenSchema = z.object({ to: z.email(), from: z.string().max(320), body: z.string().max(512_000), requestHash: z.string().regex(/^[a-f0-9]{64}$/), providerFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Frozen = z.infer<typeof frozenSchema>;
const snapshot = (d: MessageDelivery) => [d.id, d.status, d.lease_token, d.first_http_at, d.payload_enc] as const;
const predicate = "id=? AND status=? AND lease_token IS ? AND first_http_at IS ? AND payload_enc IS ?";
// Check expansion without constructing repeated large profile replacements.
// This is a memory bound, separate from the final512KB provider JSON bound.
function renderWithinBudget(template: EmailTemplate, vars: Vars, footer: string[]) {
  const encoder = new TextEncoder(); let bytes = 0;
  const add = (value: string) => { bytes += encoder.encode(value).byteLength; return bytes <= 128_000; };
  for (const text of [template.subject, template.preview, template.body, template.buttonUrl]) {
    let start = 0;
    for (const match of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      const name = match[1]!;
      if (!add(text.slice(start,match.index)) || !add((VARIABLES as readonly string[]).includes(name) ? vars[name as keyof Vars] || (name === "이름" ? "고객" : "") : match[0])) return false;
      start = match.index + match[0].length;
    }
    if (!add(text.slice(start))) return false;
  }
  return [template.buttonLabel,...footer].every(add);
}
export function createMessageSender(policy: MessagePolicy, provider: QueuedEmailProvider) {
  async function mark(env: Env, d: MessageDelivery, reason: string, status: string, lease?: string) {
    const at = Date.now();
    await env.DB.batch([
      env.DB.prepare(`UPDATE message_deliveries SET status=?,reason=?,payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE ${lease ? "id=? AND lease_token=?" : predicate} AND status NOT IN('accepted','skipped','failed','unknown','cancelled')`)
        .bind(status, reason, at, ...(lease ? [d.id, lease] : snapshot(d))),
      env.DB.prepare(`UPDATE message_delivery_receipts SET status='unknown',error_code=?,updated_at=? WHERE delivery_id=? AND status='attempting' AND EXISTS(SELECT 1 FROM message_deliveries d WHERE d.id=delivery_id AND d.status='unknown' AND d.request_hash=message_delivery_receipts.request_hash)`)
        .bind(reason, at, d.id),
    ]);
  }
  async function defer(env: Env, d: MessageDelivery, retryAt: number) {
    await env.DB.prepare(`UPDATE message_deliveries SET status='deferred',next_attempt_at=?,reason=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE ${predicate}`)
      .bind(retryAt, Date.now(), ...snapshot(d)).run();
  }
  async function send(payload: unknown, env: Env) {
    const id = payload && typeof payload === "object" ? (payload as { id?: unknown }).id : null;
    if (typeof id !== "string" || !id || id.length > 100) throw new Error("message_delivery_invalid");
    let d: MessageDelivery | null = null, lease: string | null = null;
    try {
      d = await env.DB.prepare("SELECT * FROM message_deliveries WHERE id=?").bind(id).first<MessageDelivery>();
      if (!d || terminalDelivery(d.status)) return;
      const at = Date.now();
      if (d.first_http_at !== null && (d.first_http_at <= at - MESSAGE_WINDOW || d.first_http_at > at + 60_000)) return await mark(env, d, "delivery_unknown", "unknown");
      if ((d.lease_until ?? 0) > at || d.next_attempt_at > at) return;
      const run = await env.DB.prepare("SELECT * FROM message_runs WHERE id=?").bind(d.run_id).first<MessageRun>();
      if (!run) return await mark(env, d, "source_changed", d.first_http_at === null ? "cancelled" : "unknown");
      if (!policy.configured) {
        if (d.first_http_at !== null) return await mark(env, d, "send_policy_unconfigured", "unknown");
        return await mark(env, d, "send_policy_unconfigured", "blocked");
      }
      const night = messageNight(run.kind, at); if (night !== null) return await defer(env, d, night);
      const current = await env.DB.prepare(`SELECT d.id,${eligibilitySql()} AS eligibility FROM message_deliveries d JOIN leads l ON l.id=d.lead_id JOIN message_runs r ON r.id=d.run_id WHERE d.id=? AND ${deliveryAuthority()}`).bind(id).first<{ id: string; eligibility: string }>();
      if (!current || current.eligibility !== "eligible") return await mark(env, d, current?.eligibility ?? "source_changed", d.first_http_at === null ? "skipped" : "unknown");
      if (!messageConfigured(env)) {
        if (d.first_http_at !== null) return await mark(env, d, "sender_changed", "unknown");
        await env.DB.prepare(`UPDATE message_deliveries SET status='blocked',reason='no_provider',payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE ${predicate}`).bind(at + 3_600_000, at, ...snapshot(d)).run(); return;
      }
      if (!run.snapshot_enc || run.snapshot_enc.length > 1_500_000 || (d.payload_enc?.length ?? 0) > 1_500_000) return await mark(env, d, "provider_error", d.first_http_at === null ? "failed" : "unknown");
      // Project only the one recipient and small variables, never answers/raw
      // source JSON. A single oversized legacy profile fails before buffering it.
      const join = `FROM message_deliveries d JOIN message_runs r ON r.id=d.run_id JOIN leads l ON l.id=d.lead_id
        LEFT JOIN guides g ON g.id=json_extract(l.last_source,'$.guideId') AND g.workspace_id=l.workspace_id
        LEFT JOIN influencers i ON i.id=json_extract(l.last_source,'$.influencerId') AND i.workspace_id=l.workspace_id
        WHERE d.id=? AND ${deliveryAuthority()} AND ${eligibilitySql()}='eligible'`;
      const size = ["l.email", "l.name", "l.unsubscribe_token", "g.name", "i.display_name"].map((c) => `coalesce(length(CAST(${c} AS BLOB)),0)`).join("+");
      const profileSize = await env.DB.prepare(`SELECT (${size}) AS bytes ${join}`).bind(id).first<{ bytes: number }>();
      if (profileSize && profileSize.bytes > 65536) return await mark(env, d, "provider_error", d.first_http_at === null ? "failed" : "unknown");
      const profiles = await env.DB.batch([
        env.DB.prepare(`SELECT json(CASE WHEN (${size})<=65536 THEN 'true' ELSE 'message_profile_too_large' END) ${join}`).bind(id),
        env.DB.prepare(`SELECT l.email,l.name,l.unsubscribe_token,g.name AS guide_name,i.display_name AS influencer_name ${join}`).bind(id),
      ]);
      const lead = profiles[1]!.results[0] as { email: string; name: string | null; unsubscribe_token: string; guide_name: string | null; influencer_name: string | null } | undefined;
      if (!lead) return await mark(env, d, "source_changed", d.first_http_at === null ? "cancelled" : "unknown");
      let frozen: Frozen;
      const fingerprint = await sha256Hex(env.RESEND_API_KEY!);
      if (d.payload_enc) {
        try { frozen = frozenSchema.parse(JSON.parse(await decryptToken(env.TOKEN_ENC_KEY!, d.payload_enc))); }
        catch { return await mark(env, d, "sender_changed", d.first_http_at === null ? "failed" : "unknown"); }
      }
      else {
        let config: MessageSnapshot;
        try { config = JSON.parse(await decryptToken(env.TOKEN_ENC_KEY!, run.snapshot_enc)) as MessageSnapshot; }
        catch { return await mark(env, d, "sender_changed", "failed"); }
        if (run.channel !== "email" || !isEmailTemplate(config.template)) return await mark(env, d, "alimtalk_not_connected", "skipped");
        const vars = { 이름: lead.name, 가이드명: lead.guide_name, 인플루언서명: lead.influencer_name }, unsubscribeUrl = `${env.APP_URL}/unsubscribe/${lead.unsubscribe_token}`;
        if (!renderWithinBudget(config.template,vars,[config.senderName,config.senderContact,unsubscribeUrl])) return await mark(env,d,"provider_error","failed");
        const rendered = renderEmail(config.template, vars, { kind: run.kind, senderName: config.senderName, senderContact: config.senderContact, unsubscribeUrl });
        const body = JSON.stringify({ from: messageFrom(env)!, to: [lead.email], subject: rendered.subject, text: rendered.text, html: rendered.html, tags: [{ name: "message_log_id", value: id }] });
        if (new TextEncoder().encode(body).byteLength > 512_000) return await mark(env, d, "provider_error", "failed");
        frozen = frozenSchema.parse({ to: lead.email, from: messageFrom(env)!, body, requestHash: await sha256Hex(body), providerFingerprint: fingerprint });
      }
      if (frozen.to !== lead.email || frozen.from !== messageFrom(env) || frozen.providerFingerprint !== fingerprint || frozen.requestHash !== await sha256Hex(frozen.body) || d.request_hash !== null && frozen.requestHash !== d.request_hash) return await mark(env, d, "sender_changed", d.first_http_at === null ? "cancelled" : "unknown");
      const encrypted = d.payload_enc ?? await encryptToken(env.TOKEN_ENC_KEY!, JSON.stringify(frozen));
      const recipientHmac = await messageRecipientHmac(env.TOKEN_ENC_KEY!, id, lead.email);
      lease = newToken(24);
      const claimed = await env.DB.prepare(`UPDATE message_deliveries AS d SET status='claimed',reason=NULL,payload_enc=?,request_hash=?,provider_fingerprint=?,recipient_hmac=?,lease_token=?,lease_until=?,updated_at=?
        WHERE ${predicate} AND (lease_until IS NULL OR lease_until<=?) AND next_attempt_at<=? AND ${deliveryAuthority()} AND EXISTS(SELECT 1 FROM leads l JOIN message_runs r ON r.id=d.run_id WHERE l.id=d.lead_id AND l.email=? AND ${eligibilitySql()}='eligible') RETURNING id`)
        .bind(encrypted, frozen.requestHash, fingerprint, recipientHmac, lease, at + MESSAGE_LEASE, at, ...snapshot(d), at, at, lead.email).all();
      if (!claimed.results.length) { lease = null; return; }
      const readyAt = Date.now(), retryNight = messageNight(run.kind, readyAt);
      if (retryNight !== null) { await env.DB.prepare("UPDATE message_deliveries SET status='deferred',next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND status='claimed'").bind(retryNight, id, lease).run(); lease = null; return; }
      const condition = policy.condition({ workspaceId: d.workspace_id, actorId: run.actor_id ?? "", sourceKind: run.source_kind, sourceId: run.source_id, runId: run.id, deliveryId: id, phase: "attempt" });
      const ready = await env.DB.batch([
        env.DB.prepare(`UPDATE message_deliveries AS d SET status='sending',first_http_at=coalesce(first_http_at,?),last_attempt_at=?,attempts=attempts+1,updated_at=?
          WHERE d.id=? AND d.lease_token=? AND d.status='claimed' AND (d.first_http_at IS NULL OR (d.first_http_at>? AND d.first_http_at<=?)) AND ${deliveryAuthority()}
          AND EXISTS(SELECT 1 FROM leads l JOIN message_runs r ON r.id=d.run_id WHERE l.id=d.lead_id AND l.email=? AND ${eligibilitySql()}='eligible') AND (${condition.sql}) RETURNING first_http_at`)
          .bind(readyAt, readyAt, readyAt, id, lease, readyAt - MESSAGE_WINDOW, readyAt + 60_000, lead.email, ...condition.params),
        env.DB.prepare(`INSERT INTO message_delivery_receipts(delivery_id,request_hash,provider_fingerprint,first_http_at,status,expires_at,updated_at)
          SELECT id,request_hash,provider_fingerprint,first_http_at,'attempting',?,? FROM message_deliveries WHERE id=? AND lease_token=? AND status='sending'
          ON CONFLICT(delivery_id) DO UPDATE SET updated_at=excluded.updated_at WHERE request_hash=excluded.request_hash AND provider_fingerprint=excluded.provider_fingerprint`)
          .bind(readyAt + MESSAGE_RECEIPT_RETENTION, readyAt, id, lease),
        env.DB.prepare(sqlAssertion("NOT EXISTS(SELECT 1 FROM message_deliveries WHERE id=? AND lease_token=? AND status='sending') OR EXISTS(SELECT 1 FROM message_delivery_receipts WHERE delivery_id=? AND request_hash=? AND provider_fingerprint=?)")).bind(id, lease, id, frozen.requestHash, fingerprint),
      ]);
      if (!ready[0]!.results.length) {
        const live = await env.DB.prepare(`SELECT 1 FROM message_deliveries d WHERE d.id=? AND ${deliveryAuthority()}`).bind(id).first();
        await mark(env, d, live ? "send_policy_denied" : "source_changed", d.first_http_at !== null ? "unknown" : live ? "blocked" : "cancelled", lease); lease = null; return;
      }
      const firstHttp = (ready[0]!.results[0] as { first_http_at: number }).first_http_at;
      const afterReady = Date.now(), lateNight = messageNight(run.kind, afterReady);
      if (lateNight !== null) {
        // We know this worker has not called HTTP. Undo only a first, still-owned
        // intent; never remove evidence from a previous uncertain attempt.
        await env.DB.batch([
          ...(d.first_http_at === null ? [env.DB.prepare("DELETE FROM message_delivery_receipts WHERE delivery_id=? AND status='attempting' AND first_http_at=? AND EXISTS(SELECT 1 FROM message_deliveries WHERE id=? AND lease_token=? AND status='sending')").bind(id, firstHttp, id, lease)] : []),
          env.DB.prepare(`UPDATE message_deliveries SET status='deferred',next_attempt_at=?,first_http_at=${d.first_http_at === null ? "NULL" : "first_http_at"},attempts=max(0,attempts-1),last_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND status='sending'`).bind(lateNight, d.last_attempt_at, id, lease),
        ]); lease = null; return;
      }
      if (firstHttp <= afterReady - MESSAGE_WINDOW) { await mark(env, d, "delivery_unknown", "unknown", lease); lease = null; return; }
      const result = await provider(env, frozen.body, id);
      if (result.kind === "accepted") {
        await env.DB.batch([
          env.DB.prepare("UPDATE message_delivery_receipts SET status='accepted',provider_id=?,error_code=NULL,updated_at=? WHERE delivery_id=? AND request_hash=? AND provider_fingerprint=? AND (provider_id IS NULL OR provider_id=?)")
            .bind(result.id, Date.now(), id, frozen.requestHash, fingerprint, result.id),
          env.DB.prepare(`INSERT INTO message_logs(id,workspace_id,lead_id,source,source_id,channel,status,reason,provider_id,recipient_email,lead_created_at,lead_birth_revision,at)
            SELECT d.id,d.workspace_id,l.id,r.source_kind,r.source_id,'email',CASE WHEN EXISTS(SELECT 1 FROM email_bounce_pending p WHERE p.delivery_id=d.id AND p.provider_id=? AND p.recipient_hmac=?) THEN 'bounced' ELSE 'sent' END,
            CASE WHEN EXISTS(SELECT 1 FROM email_bounce_pending p WHERE p.delivery_id=d.id AND p.provider_id=? AND p.recipient_hmac=?) THEN 'bounced' ELSE NULL END,?,l.email,l.created_at,b.revision,?
            FROM message_deliveries d JOIN message_runs r ON r.id=d.run_id JOIN leads l ON l.id=d.lead_id AND l.workspace_id=d.workspace_id JOIN lead_import_births b ON b.lead_id=l.id AND b.workspace_id=l.workspace_id
            JOIN message_delivery_receipts receipt ON receipt.delivery_id=d.id AND receipt.status='accepted' AND receipt.provider_id=?
            WHERE d.id=? AND l.deleted_at IS NULL AND l.email=? AND l.created_at=d.lead_created_at AND b.revision=d.lead_birth_revision
            ON CONFLICT(id) DO UPDATE SET provider_id=excluded.provider_id,status=CASE WHEN message_logs.status='bounced' THEN 'bounced' ELSE excluded.status END,reason=CASE WHEN message_logs.status='bounced' THEN 'bounced' ELSE excluded.reason END`)
            .bind(result.id, recipientHmac, result.id, recipientHmac, result.id, Date.now(), result.id, id, frozen.to),
          ...pendingBounceStatements(env.DB, id, result.id, recipientHmac),
          env.DB.prepare(`UPDATE message_deliveries SET status='accepted',reason=NULL,provider_id=?,payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND request_hash=? AND provider_fingerprint=?
            AND EXISTS(SELECT 1 FROM message_delivery_receipts WHERE delivery_id=? AND status='accepted' AND provider_id=? AND request_hash=? AND provider_fingerprint=?)`)
            .bind(result.id, Date.now(), id, frozen.requestHash, fingerprint, id, result.id, frozen.requestHash, fingerprint),
          env.DB.prepare("DELETE FROM email_bounce_pending WHERE delivery_id=? AND provider_id=?").bind(id, result.id),
        ]);
      } else if (result.kind === "rejected" || result.kind === "conflict") {
        await mark(env, d, result.kind === "conflict" ? "delivery_unknown" : "provider_error", result.kind === "conflict" ? "unknown" : "failed", lease);
        await env.DB.prepare("UPDATE message_delivery_receipts SET status=?,error_code=?,updated_at=? WHERE delivery_id=? AND status='attempting' AND EXISTS(SELECT 1 FROM message_deliveries d WHERE d.id=delivery_id AND d.status=? AND d.request_hash=message_delivery_receipts.request_hash AND d.provider_fingerprint=message_delivery_receipts.provider_fingerprint)").bind(result.kind === "conflict" ? "unknown" : "failed", result.code, Date.now(), id, result.kind === "conflict" ? "unknown" : "failed").run();
      } else {
        await env.DB.prepare("UPDATE message_deliveries SET status='retry',reason=NULL,lease_token=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND lease_token=? AND status='sending'")
          .bind(Math.min(result.retryAt ?? Date.now() + MESSAGE_RETRY, firstHttp + MESSAGE_WINDOW), Date.now(), id, lease).run();
        await env.DB.prepare("UPDATE message_delivery_receipts SET error_code=?,updated_at=? WHERE delivery_id=? AND status='attempting'").bind(result.code, Date.now(), id).run();
      }
      lease = null;
    } catch {
      if (d && lease) await env.DB.prepare("UPDATE message_deliveries SET status='retry',reason=NULL,lease_token=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND lease_token=? AND status IN('claimed','sending')")
        .bind(Date.now() + MESSAGE_RETRY, Date.now(), d.id, lease).run().catch(() => {});
      throw new Error("message_delivery_failed");
    }
  }
  async function cleanup(env: Env) {
    const at = Date.now();
    await env.DB.batch([
      env.DB.prepare(`UPDATE message_deliveries SET status='unknown',reason='delivery_unknown',payload_enc=NULL,recipient_hmac=NULL,lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE id IN(SELECT id FROM message_deliveries WHERE first_http_at IS NOT NULL AND first_http_at<=? AND status NOT IN('accepted','skipped','failed','unknown','cancelled') AND (lease_until IS NULL OR lease_until<=?) ORDER BY first_http_at,id LIMIT ?)`)
        .bind(at, at - MESSAGE_WINDOW, at, MESSAGE_PAGE),
      env.DB.prepare("UPDATE message_delivery_receipts SET status='unknown',error_code='delivery_unknown',updated_at=? WHERE delivery_id IN(SELECT delivery_id FROM message_delivery_receipts WHERE status='attempting' AND first_http_at<=? ORDER BY first_http_at,delivery_id LIMIT ?)").bind(at, at - MESSAGE_WINDOW, MESSAGE_PAGE),
      env.DB.prepare("DELETE FROM email_bounce_pending WHERE rowid IN(SELECT rowid FROM email_bounce_pending WHERE expires_at<=? ORDER BY expires_at LIMIT 1000)").bind(at),
      env.DB.prepare("DELETE FROM message_delivery_receipts WHERE delivery_id IN(SELECT delivery_id FROM message_delivery_receipts WHERE expires_at<=? ORDER BY expires_at,delivery_id LIMIT 1000)").bind(at),
      env.DB.prepare("DELETE FROM message_runs WHERE id IN(SELECT id FROM message_runs WHERE status IN('completed','cancelled') AND updated_at<=? ORDER BY updated_at,id LIMIT 100)").bind(at - MESSAGE_RECEIPT_RETENTION),
    ]);
  }
  return { send, cleanup };
}
