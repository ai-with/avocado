import { decryptToken, encryptToken } from "../crypto";
import { newToken, sha256Hex } from "../ids";
import { normalizeEmail } from "./aggregate";
import { identifyEffectStatements, identifySourceIsCurrent, MAX_IDENTIFY_AGE_MS, type IdentifyJob, type IdentifyPayload, type StoredIdentifyJob } from "./people";

const FAILURE = "identify_job_failed";
export const IDENTIFY_MAINTENANCE_LIMIT = 100;
export const IDENTIFY_DISPATCH_LIMIT = 50;
const RESEND_DELAY_MS = 60_000;

const encryptionKey = (env: Env): string => {
  if (!env.TOKEN_ENC_KEY || env.TOKEN_ENC_KEY !== env.TOKEN_ENC_KEY.trim()) throw new Error(FAILURE);
  return env.TOKEN_ENC_KEY;
};

// The caller supplies only freshly accepted identify events. This single bulk statement must be
// committed after the session write, in the SAME native D1 batch as aggregates and event IDs.
export async function prepareIdentifyJobs(env: Env, jobs: IdentifyJob[]): Promise<{ statement: D1PreparedStatement | null; ids: string[] }> {
  const at = Date.now();
  const valid = jobs.filter((job) => Number.isFinite(job.receivedAt) && job.receivedAt <= at && job.receivedAt > at - MAX_IDENTIFY_AGE_MS);
  if (!valid.length) return { statement: null, ids: [] };
  try {
    const key = encryptionKey(env);
    const rows = await Promise.all(valid.map(async (job) => {
      const email = job.event.email ? normalizeEmail(job.event.email) : null;
      const payload: IdentifyPayload = { email: job.site.collectRawEmail ? email : null, name: job.site.collectRawEmail ? job.event.name?.trim() || null : null, externalId: job.event.externalId ?? null, linkId: job.linkId };
      return { id: await sha256Hex(JSON.stringify(["identify", job.site.id, job.event.id])), site_id: job.site.id, workspace_id: job.site.workspaceId,
        session_id: job.sessionId, anon_id: job.anonId, event_id: job.event.id, received_at: job.receivedAt, expires_at: job.receivedAt + MAX_IDENTIFY_AGE_MS,
        email_hash: email ? await sha256Hex(email) : job.event.emailHash ?? null, payload_enc: await encryptToken(key, JSON.stringify(payload)),
        minimal_payload_enc: await encryptToken(key, JSON.stringify({ ...payload, email: null, name: null })) };
    }));
    const value = (column: string) => `json_extract(candidate.value, '$.${column}')`;
    const columns = ["id", "site_id", "workspace_id", "session_id", "anon_id", "event_id", "received_at", "expires_at", "email_hash", "payload_enc"];
    const statement = env.DB.prepare(`INSERT INTO site_identify_jobs (${columns.join(", ")}, status, attempts, next_attempt_at, created_at, updated_at)
      SELECT ${columns.map((column) => column === "payload_enc" ? `CASE WHEN s.collect_raw_email = 1 THEN ${value(column)} ELSE ${value("minimal_payload_enc")} END` : value(column)).join(", ")}, 'pending', 0, ?, ?, ? FROM json_each(?) candidate
      JOIN sites s ON s.id = ${value("site_id")} AND s.workspace_id = ${value("workspace_id")} AND s.deleted_at IS NULL
      JOIN site_sessions ss ON ss.site_id = s.id AND ss.id = ${value("session_id")} AND ss.anon_id = ${value("anon_id")}
      WHERE ${value("received_at")} <= ? AND ${value("expires_at")} > ? ON CONFLICT(site_id, event_id) DO NOTHING`)
      .bind(at, at, at, JSON.stringify(rows), at, at);
    return { statement, ids: rows.map((row) => row.id) };
  } catch { throw new Error(FAILURE); }
}

function parsePayload(plain: string): IdentifyPayload {
  const value: unknown = JSON.parse(plain);
  if (!value || typeof value !== "object") throw new Error(FAILURE);
  const record = value as Record<string, unknown>;
  for (const key of ["email", "name", "externalId", "linkId"]) if (record[key] !== null && typeof record[key] !== "string") throw new Error(FAILURE);
  return record as IdentifyPayload;
}

export async function processIdentifyJob(payload: { id: string }, env: Env): Promise<void> {
  let job: StoredIdentifyJob | null = null;
  try {
    job = await env.DB.prepare("SELECT id, site_id, workspace_id, session_id, anon_id, event_id, received_at, expires_at, email_hash, payload_enc, status FROM site_identify_jobs WHERE id = ?")
      .bind(payload.id).first<StoredIdentifyJob>();
    if (!job || job.status !== "pending" || !job.payload_enc) return;
    const checkedAt = Date.now();
    // Expired ciphertext is never decrypted or used by an SDK writer.
    if (!Number.isFinite(job.received_at) || job.received_at > checkedAt || job.received_at < checkedAt - MAX_IDENTIFY_AGE_MS || job.expires_at <= checkedAt) {
      await env.DB.prepare("UPDATE site_identify_jobs SET status = 'expired', payload_enc = NULL, claim_token = NULL, updated_at = ? WHERE id = ? AND status = 'pending' AND payload_enc = ?")
        .bind(checkedAt, job.id, job.payload_enc).run();
      return;
    }
    const decoded = parsePayload(await decryptToken(encryptionKey(env), job.payload_enc));
    const token = newToken();
    const at = Date.now();
    await env.DB.batch([
      env.DB.prepare(`UPDATE site_identify_jobs AS j SET claim_token = ?, attempts = attempts + 1, resolved_person_id = NULL, resolved_lead_id = NULL, updated_at = ?
        WHERE j.id = ? AND j.status = 'pending' AND j.claim_token IS NULL AND j.payload_enc = ?
        AND j.received_at >= ? AND j.received_at <= ? AND j.expires_at > ? AND ${identifySourceIsCurrent("j")}`)
        .bind(token, at, job.id, job.payload_enc, at - MAX_IDENTIFY_AGE_MS, at, at),
      ...identifyEffectStatements(env.DB, job, decoded, token, at),
      env.DB.prepare(`UPDATE site_identify_jobs AS j SET status = CASE WHEN j.expires_at <= ? OR j.received_at > ? OR j.received_at < ? THEN 'expired' ELSE 'cancelled' END,
        payload_enc = NULL, claim_token = NULL, updated_at = ? WHERE j.id = ? AND j.status = 'pending'
        AND (j.expires_at <= ? OR j.received_at > ? OR j.received_at < ? OR NOT (${identifySourceIsCurrent("j")}))`)
        .bind(at, at, at - MAX_IDENTIFY_AGE_MS, at, job.id, at, at, at - MAX_IDENTIFY_AGE_MS),
    ]);
  } catch {
    // Rollback leaves the original encrypted work durable. A lost commit response cannot turn a
    // completed receipt back into pending. Never persist/log D1's bound values or exception cause.
    if (job?.payload_enc) await env.DB.prepare(`UPDATE site_identify_jobs SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending' AND claim_token IS NULL AND payload_enc = ?`)
      .bind(FAILURE, Date.now() + RESEND_DELAY_MS, Date.now(), job.id, job.payload_enc).run().catch(() => {});
    throw new Error(FAILURE);
  }
}

// Bounded maintenance uses the existing pipeline. Only deterministic IDs leave D1.
export async function maintainIdentifyJobs(env: Env): Promise<void> {
  const at = Date.now();
  try {
    const swept = await env.DB.batch([
      env.DB.prepare(`DELETE FROM site_identify_jobs WHERE id IN (SELECT id FROM site_identify_jobs WHERE expires_at <= ? ORDER BY (payload_enc IS NULL), expires_at, id LIMIT ?)`)
        .bind(at, IDENTIFY_MAINTENANCE_LIMIT),
      env.DB.prepare(`UPDATE site_identify_jobs SET status = 'cancelled', payload_enc = NULL, claim_token = NULL, updated_at = ? WHERE id IN (
        SELECT j.id FROM site_identify_jobs j WHERE j.status = 'pending' AND NOT (${identifySourceIsCurrent("j")}) ORDER BY j.received_at, j.id LIMIT ?)`)
        .bind(at, IDENTIFY_MAINTENANCE_LIMIT),
    ]);
    const due = await env.DB.prepare(`UPDATE site_identify_jobs SET next_attempt_at = ?, updated_at = ? WHERE id IN (
      SELECT j.id FROM site_identify_jobs j WHERE j.status = 'pending' AND j.payload_enc IS NOT NULL AND j.next_attempt_at <= ?
      AND j.received_at <= ? AND j.expires_at > ? AND ${identifySourceIsCurrent("j")} ORDER BY j.next_attempt_at, j.id LIMIT ?) RETURNING id`)
      .bind(at + RESEND_DELAY_MS, at, at, at, at, IDENTIFY_DISPATCH_LIMIT).all<{ id: string }>();
    if (due.results.length) await env.PIPELINE.sendBatch(due.results.map(({ id }) => ({ body: { type: "collect_identify", payload: { id } } })));
    console.log("[identify_maintenance]", JSON.stringify({ expiredDeleted: swept[0]!.meta.changes, inactiveScrubbed: swept[1]!.meta.changes, queued: due.results.length, failures: 0 }));
  } catch {
    console.error("[identify_maintenance_failed]", JSON.stringify({ failures: 1 }));
    throw new Error(FAILURE);
  }
}
