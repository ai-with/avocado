import { sql, type SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { getDb, type Db } from "../db";
import { igConnections } from "../db/schema";
import { COLLECTION_GRACE_MS } from "./content-collection";
import { encryptToken, decryptToken } from "./crypto";
import { sendEmail, type EmailMessage } from "./email";
import { escapeHtml } from "./html";
import { newId, newToken, now, sha256Hex } from "./ids";
import { igConnectionState, igGrantVerified, igGrantVerifiedSql, type IgDisconnectReason } from "./ig-connection-state";

const RETRY_MS = 15 * 60_000;
const LEASE_MS = 5 * 60_000;
const IDEMPOTENCY_MS = 24 * 3_600_000;
const SEND_MARGIN_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;
const dialect = new SQLiteSyncDialect();
const nativeBatch = (db: Db, statements: SQL[]) => db.$client.batch(statements.map((statement) => {
  const query = dialect.sqlToQuery(statement);
  return db.$client.prepare(query.sql).bind(...query.params);
}));
type Connection = typeof igConnections.$inferSelect;
type MailStatus = "queued" | "sending" | "blocked" | "sent" | "failed" | "unknown" | "cancelled";
type MailJob = { id: string; connectionId: string; generation: string; workspaceId: string; recipientKind: "brand" | "influencer"; recipientId: string; reason: string; disconnectedAt: number; status: MailStatus; payloadEnc: string | null; firstAttemptAt: number | null; lastAttemptAt: number | null; nextAttemptAt: number; leaseToken: string | null; attempts: number };
const columns = sql.raw("id,connection_id AS connectionId,connection_generation AS generation,workspace_id AS workspaceId,recipient_kind AS recipientKind,recipient_id AS recipientId,reason,disconnected_at AS disconnectedAt,status,payload_enc AS payloadEnc,first_attempt_at AS firstAttemptAt,last_attempt_at AS lastAttemptAt,next_attempt_at AS nextAttemptAt,lease_token AS leaseToken,attempts");
const idJob = z.object({ id: z.string().min(1).max(100) }).strict();
const checkJob = z.object({ id: z.string().min(1).max(100), generation: z.string().min(1).max(100) }).strict();
const mailSchema = z.object({ from: z.string().min(1).max(320), to: z.email(), subject: z.string().max(500), text: z.string().max(16_000), html: z.string().max(24_000), path: z.string().max(1000), url: z.url().max(2000), providerFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type FrozenMail = z.infer<typeof mailSchema>;
const configured = (env: Env) => Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim() && env.TOKEN_ENC_KEY);
const terminal = (status: MailStatus) => ["sent", "unknown", "cancelled"].includes(status);

export async function disconnectIgConnection(env: Env, db: Db, connection: Connection, reason: IgDisconnectReason): Promise<{ changed: boolean; generation: string | null }> {
  if (reason === "manual" || !igGrantVerified(connection) || !connection.connectedAt || connection.disconnectedAt !== null || connection.revokedAt !== null) return { changed: false, generation: null };
  const state = igConnectionState(connection);
  if (reason !== "provider_auth_invalid" && state.reason !== reason) return { changed: false, generation: null };
  const at = now(), generation = newToken(18), status = configured(env) ? "queued" : "blocked";
  const result = await nativeBatch(db, [
    sql`UPDATE ig_connections SET generation=${generation},disconnected_at=${at},disconnected_reason=${reason},token_enc=NULL
      WHERE id=${connection.id} AND workspace_id=${connection.workspaceId} AND generation=${connection.generation}
      AND token_enc IS ${connection.tokenEnc} AND expires_at IS ${connection.expiresAt} AND grants_verified_at IS ${connection.grantsVerifiedAt}
      AND connected_at IS NOT NULL AND revoked_at IS NULL AND disconnected_at IS NULL RETURNING generation`,
    sql`UPDATE keyword_dm_rules SET status='paused',enabled=0,paused_reason=${reason},updated_at=${at}
      WHERE ig_connection_id=${connection.id} AND workspace_id=${connection.workspaceId}
      AND EXISTS(SELECT 1 FROM ig_connections g WHERE g.id=${connection.id} AND g.generation=${generation} AND g.disconnected_at=${at})`,
    sql`INSERT INTO ig_disconnect_mail_outbox (id,connection_id,connection_generation,workspace_id,recipient_kind,recipient_id,reason,disconnected_at,status,next_attempt_at,error_code,created_at,updated_at)
      SELECT lower(hex(randomblob(16))),g.id,g.generation,g.workspace_id,'brand',m.user_id,${reason},${at},${status},${status === "blocked" ? at + RETRY_MS : at},${status === "blocked" ? "mail_not_configured" : null},${at},${at}
      FROM ig_connections g JOIN workspaces w ON w.id=g.workspace_id JOIN members m ON m.workspace_id=g.workspace_id JOIN users u ON u.id=m.user_id
      WHERE g.id=${connection.id} AND g.generation=${generation} AND g.disconnected_at=${at} AND m.role IN ('owner','editor') ON CONFLICT DO NOTHING`,
    sql`INSERT INTO ig_disconnect_mail_outbox (id,connection_id,connection_generation,workspace_id,recipient_kind,recipient_id,reason,disconnected_at,status,next_attempt_at,error_code,created_at,updated_at)
      SELECT lower(hex(randomblob(16))),g.id,g.generation,g.workspace_id,'influencer',i.id,${reason},${at},${status},${status === "blocked" ? at + RETRY_MS : at},${status === "blocked" ? "mail_not_configured" : null},${at},${at}
      FROM ig_connections g JOIN workspaces w ON w.id=g.workspace_id JOIN influencers i ON i.id=g.influencer_id AND i.workspace_id=g.workspace_id
      WHERE g.id=${connection.id} AND g.generation=${generation} AND g.disconnected_at=${at} AND g.target='influencer' ON CONFLICT DO NOTHING`,
  ]);
  if (!result[0]!.results.length) return { changed: false, generation: null };
  if (status === "queued") {
    const mail = await db.all<{ id: string }>(sql`SELECT id FROM ig_disconnect_mail_outbox WHERE connection_id=${connection.id} AND connection_generation=${generation} AND status='queued' ORDER BY id LIMIT 50`);
    if (mail.length) {
      try { await env.PIPELINE.sendBatch(mail.map((row) => ({ body: { type: "ig_disconnect_mail", payload: { id: row.id } } }))); }
      catch {
        // 상태 전환은 이미 커밋됐다. 미전송 원장과 실패 증거를 남겨 다음 유지보수가 다시 넣는다.
        await db.run(sql`UPDATE ig_disconnect_mail_outbox SET error_code='queue_enqueue_failed' WHERE connection_id=${connection.id} AND connection_generation=${generation} AND status='queued'`);
        console.error("[ig_disconnect_mail_enqueue_failed]", JSON.stringify({ queued: mail.length, failures: 1 }));
      }
    }
  }
  return { changed: true, generation };
}

export async function processIgConnectionCheck(raw: unknown, env: Env): Promise<void> {
  const job = checkJob.parse(raw), db = getDb(env.DB);
  const connection = (await db.select().from(igConnections).where(sql`${igConnections.id}=${job.id} AND ${igConnections.generation}=${job.generation}`).get());
  if (!connection) return;
  const state = igConnectionState(connection);
  if (state.reason === "expired" || state.reason === "token_missing") await disconnectIgConnection(env, db, connection, state.reason);
}

export async function enqueueIgConnectionMaintenance(env: Env): Promise<void> {
  await env.PIPELINE.sendBatch([{ body: { type: "ig_connection_maintenance", payload: {} } }]);
}

export async function processIgConnectionMaintenance(raw: unknown, env: Env): Promise<void> {
  z.object({}).strict().parse(raw);
  const db = getDb(env.DB), at = now();
  const result = await nativeBatch(db, [
    sql`UPDATE ig_disconnect_mail_outbox SET status='unknown',payload_enc=NULL,lease_token=NULL,error_code='delivery_window_expired',updated_at=${at}
      WHERE first_attempt_at IS NOT NULL AND first_attempt_at<=${at - IDEMPOTENCY_MS + SEND_MARGIN_MS} AND status IN ('queued','sending','failed','blocked')`,
    sql`UPDATE ig_disconnect_mail_outbox SET status=CASE WHEN first_attempt_at IS NULL THEN 'cancelled' ELSE 'unknown' END,payload_enc=NULL,lease_token=NULL,error_code='connection_changed',updated_at=${at}
      WHERE status IN ('queued','sending','failed','blocked') AND NOT EXISTS (
        SELECT 1 FROM ig_connections g JOIN workspaces w ON w.id=g.workspace_id WHERE g.id=connection_id AND g.generation=connection_generation AND g.workspace_id=ig_disconnect_mail_outbox.workspace_id AND g.disconnected_at IS NOT NULL)`,
    sql`SELECT g.id,g.generation FROM ig_connections g JOIN workspaces w ON w.id=g.workspace_id
      WHERE g.connected_at IS NOT NULL AND g.disconnected_at IS NULL AND g.revoked_at IS NULL AND ${igGrantVerifiedSql("g")}
      AND (g.token_enc IS NULL OR g.token_enc='' OR g.expires_at IS NULL OR g.expires_at<=${at}) ORDER BY g.expires_at,g.id LIMIT 20`,
    sql`SELECT id FROM ig_disconnect_mail_outbox WHERE (status IN ('queued','failed','blocked') AND next_attempt_at<=${at})
      OR (status='sending' AND last_attempt_at<${at - LEASE_MS}) ORDER BY updated_at,id LIMIT 50`,
    sql`DELETE FROM ig_oauth_states WHERE state_hash IN (SELECT state_hash FROM ig_oauth_states WHERE expires_at<=${at - 5 * 60_000} ORDER BY expires_at,state_hash LIMIT 1000)`,
  ]);
  const checks = result[2]!.results as { id: string; generation: string }[], mail = result[3]!.results as { id: string }[];
  const messages = [...checks.map((row) => ({ body: { type: "check_ig_connection", payload: row } })), ...mail.map((row) => ({ body: { type: "ig_disconnect_mail", payload: row } }))];
  if (messages.length) await env.PIPELINE.sendBatch(messages);
  console.log("[ig_connection_maintenance]", JSON.stringify({ connectionChecksQueued: checks.length, recipientMailQueued: mail.length,
    expiredMailClosed: result[0]!.meta.changes, staleMailClosed: result[1]!.meta.changes, oauthStatesDeleted: result[4]!.meta.changes, failures: 0 }));
}

function authority(job: MailJob, email?: string) {
  return sql`EXISTS (SELECT 1 FROM ig_connections g JOIN workspaces w ON w.id=g.workspace_id
    WHERE g.id=${job.connectionId} AND g.generation=${job.generation} AND g.workspace_id=${job.workspaceId} AND g.disconnected_at=${job.disconnectedAt}
    AND (${job.recipientKind}='brand' AND EXISTS (SELECT 1 FROM members m JOIN users u ON u.id=m.user_id
      WHERE m.workspace_id=g.workspace_id AND m.user_id=${job.recipientId} AND m.role IN ('owner','editor') ${email ? sql`AND lower(trim(u.email))=${email}` : sql``})
    OR ${job.recipientKind}='influencer' AND EXISTS (SELECT 1 FROM influencers i WHERE i.id=${job.recipientId} AND i.id=g.influencer_id AND i.workspace_id=g.workspace_id ${email ? sql`AND lower(trim(i.email))=${email}` : sql``})))`;
}

function linkAuthority(job: MailJob, path: string) {
  if (job.recipientKind === "brand") return sql`${path}='/dashboard/settings/integrations'`;
  const match = /^\/connect\/([\w-]{8,200})\?lang=(ko|en)&returnMode=guide$/.exec(path);
  if (!match) return sql`0`;
  return sql`EXISTS (SELECT 1 FROM guide_influencers gi JOIN guides g ON g.id=gi.guide_id
    JOIN influencers i ON i.id=gi.influencer_id AND i.workspace_id=g.workspace_id JOIN campaigns p ON p.id=g.campaign_id AND p.workspace_id=g.workspace_id
    WHERE gi.connect_token=${match[1]!} AND gi.influencer_id=${job.recipientId} AND g.workspace_id=${job.workspaceId}
    AND g.status='published' AND gi.token_expires_at>${now()}
    AND ((p.ends_at IS NULL AND p.status='active') OR (p.ends_at IS NOT NULL AND p.ends_at+${COLLECTION_GRACE_MS}>${now()})))`;
}

async function recipient(db: Db, job: MailJob) {
  const context = (await db.all<{ name: string }>(sql`SELECT w.name FROM workspaces w WHERE w.id=${job.workspaceId} AND ${authority(job)}`))[0];
  if (!context) return null;
  const contact = job.recipientKind === "brand"
    ? (await db.all<{ email: string }>(sql`SELECT email FROM users WHERE id=${job.recipientId}`))[0]
    : (await db.all<{ email: string | null }>(sql`SELECT email FROM influencers WHERE id=${job.recipientId} AND workspace_id=${job.workspaceId}`))[0];
  const email = contact?.email?.trim().toLowerCase();
  if (!email || !z.email().safeParse(email).success) return { blocked: "recipient_email_missing" as const };
  if (job.recipientKind === "brand") return { email, name: context.name, path: "/dashboard/settings/integrations" };
  const guide = (await db.all<{ token: string; lang: string }>(sql`SELECT gi.connect_token AS token,i.lang FROM guide_influencers gi JOIN guides g ON g.id=gi.guide_id
    JOIN influencers i ON i.id=gi.influencer_id AND i.workspace_id=g.workspace_id JOIN campaigns p ON p.id=g.campaign_id AND p.workspace_id=g.workspace_id
    WHERE gi.influencer_id=${job.recipientId} AND g.workspace_id=${job.workspaceId} AND g.status='published' AND gi.token_expires_at>${now()}
    AND ((p.ends_at IS NULL AND p.status='active') OR (p.ends_at IS NOT NULL AND p.ends_at+${COLLECTION_GRACE_MS}>${now()}))
    ORDER BY gi.created_at DESC,gi.id LIMIT 1`))[0];
  if (!guide) return { blocked: "reconnect_link_unavailable" as const };
  return { email, name: context.name, path: `/connect/${encodeURIComponent(guide.token)}?lang=${guide.lang === "en" ? "en" : "ko"}&returnMode=guide` };
}

async function closeMail(db: Db, job: MailJob, status: MailStatus, code: string, ownedLease?: string) {
  await db.run(sql`UPDATE ig_disconnect_mail_outbox SET status=CASE WHEN ${status}='cancelled' AND first_attempt_at IS NOT NULL THEN 'unknown' ELSE ${status} END,
    payload_enc=NULL,lease_token=NULL,error_code=${code},updated_at=${now()}
    WHERE id=${job.id} AND ${ownedLease ? sql`status='sending' AND lease_token=${ownedLease}` : sql`status=${job.status} AND lease_token IS ${job.leaseToken} AND first_attempt_at IS ${job.firstAttemptAt} AND payload_enc IS ${job.payloadEnc}`}
    AND status NOT IN ('sent','unknown','cancelled')`);
}
async function blockMail(db: Db, job: MailJob, code: string) {
  await db.run(sql`UPDATE ig_disconnect_mail_outbox SET status='blocked',error_code=${code},lease_token=NULL,next_attempt_at=${now() + RETRY_MS},updated_at=${now()}
    WHERE id=${job.id} AND status=${job.status} AND lease_token IS ${job.leaseToken} AND first_attempt_at IS ${job.firstAttemptAt} AND payload_enc IS ${job.payloadEnc}
    AND status NOT IN ('sent','unknown','cancelled')`);
}

export async function processIgDisconnectMail(raw: unknown, env: Env): Promise<void> {
  const { id } = idJob.parse(raw), db = getDb(env.DB);
  const job = (await db.all<MailJob>(sql`SELECT ${columns} FROM ig_disconnect_mail_outbox WHERE id=${id}`))[0];
  if (!job || terminal(job.status) || (job.status === "sending" && (job.lastAttemptAt ?? 0) >= now() - LEASE_MS)) return;
  // Provider 키 보관 시간 끝에 걸치는 전송도 피한다. 1분 여유를 두고 자동 재전송을 닫는다.
  if (job.firstAttemptAt !== null && job.firstAttemptAt <= now() - IDEMPOTENCY_MS + SEND_MARGIN_MS) return closeMail(db, job, "unknown", "delivery_window_expired");
  // Queue의 즉시 중복/재시도도 영속 backoff를 건너뛰지 않는다. due가 되면 유지보수가 다시 넣는다.
  if (job.status !== "sending" && job.nextAttemptAt > now()) return;
  const target = await recipient(db, job);
  if (!target) return closeMail(db, job, job.firstAttemptAt === null ? "cancelled" : "unknown", "recipient_or_connection_changed");
  if (!configured(env)) return blockMail(db, job, "mail_not_configured");
  if ("blocked" in target) return blockMail(db, job, target.blocked ?? "recipient_unavailable");
  let payload: FrozenMail;
  try {
    if (job.payloadEnc) payload = mailSchema.parse(JSON.parse(await decryptToken(env.TOKEN_ENC_KEY!, job.payloadEnc)));
    else {
      const url = new URL(target.path, env.APP_URL).href;
      const text = `${target.name}의 인스타그램 연결을 확인해 주세요.\n연결이 끊겨 성과 수집 또는 댓글 DM이 중단될 수 있어요.\n${url}`;
      payload = mailSchema.parse({ from: env.EMAIL_FROM!.trim(), to: target.email, path: target.path, url, providerFingerprint: await sha256Hex(env.RESEND_API_KEY!), subject: "인스타그램 연결을 다시 확인해 주세요", text, html: `<p>${escapeHtml(target.name)}의 인스타그램 연결을 확인해 주세요.</p><p>연결이 끊겨 성과 수집 또는 댓글 DM이 중단될 수 있어요.</p><p><a href="${escapeHtml(url)}">다시 연결하기</a></p>` });
    }
  } catch { return closeMail(db, job, "unknown", "payload_unavailable"); }
  if (payload.to !== target.email || payload.path !== target.path || payload.url !== new URL(target.path, env.APP_URL).href || payload.from !== env.EMAIL_FROM!.trim() || payload.providerFingerprint !== await sha256Hex(env.RESEND_API_KEY!)) return closeMail(db, job, job.firstAttemptAt === null ? "cancelled" : "unknown", "mail_target_changed");
  const lease = newId(), encrypted = job.payloadEnc ?? await encryptToken(env.TOKEN_ENC_KEY!, JSON.stringify(payload));
  const claimed = await db.all<{ first: number }>(sql`UPDATE ig_disconnect_mail_outbox SET status='sending',payload_enc=${encrypted},first_attempt_at=coalesce(first_attempt_at,${now()}),
    last_attempt_at=${now()},lease_token=${lease},attempts=attempts+1,error_code=NULL,updated_at=${now()}
    WHERE id=${job.id} AND (status IN ('queued','blocked','failed') OR (status='sending' AND last_attempt_at<${now() - LEASE_MS}))
    AND status=${job.status} AND lease_token IS ${job.leaseToken} AND first_attempt_at IS ${job.firstAttemptAt} AND payload_enc IS ${job.payloadEnc}
    AND (status='sending' OR next_attempt_at<=${now()})
    AND (first_attempt_at IS NULL OR first_attempt_at>${now() - IDEMPOTENCY_MS + SEND_MARGIN_MS}) AND ${authority(job, payload.to)} AND ${linkAuthority(job, payload.path)} RETURNING first_attempt_at AS first`);
  if (!claimed.length) return;
  // claim 뒤 권한·연결 세대·주소가 바뀐 경우 HTTP를 시작하지 않는다.
  const ready = await db.all<{ id: string }>(sql`SELECT id FROM ig_disconnect_mail_outbox WHERE id=${job.id} AND lease_token=${lease} AND status='sending'
    AND first_attempt_at>${now() - IDEMPOTENCY_MS + SEND_MARGIN_MS} AND ${authority(job, payload.to)} AND ${linkAuthority(job, payload.path)}`);
  if (!ready.length) return closeMail(db, job, "unknown", "recipient_or_connection_changed", lease);
  const message: EmailMessage = { to: payload.to, subject: payload.subject, text: payload.text, html: payload.html };
  try {
    const response = await sendEmail(env, message, { idempotencyKey: `ig-disconnect/${job.id}`, timeoutMs: HTTP_TIMEOUT_MS, logProviderErrors: false, from: payload.from });
    if (!response.delivered) throw new Error("ig_mail_provider_failed");
    await db.run(sql`UPDATE ig_disconnect_mail_outbox SET status='sent',provider_id=${response.id},payload_enc=NULL,lease_token=NULL,error_code=NULL,updated_at=${now()} WHERE id=${job.id} AND lease_token=${lease} AND status='sending'`);
  } catch {
    await db.run(sql`UPDATE ig_disconnect_mail_outbox SET status='failed',lease_token=NULL,error_code='provider_unavailable',next_attempt_at=${now() + RETRY_MS},updated_at=${now()} WHERE id=${job.id} AND lease_token=${lease} AND status='sending'`);
    throw new Error("ig_mail_delivery_failed");
  }
}
