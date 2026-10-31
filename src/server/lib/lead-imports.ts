import { z } from "zod";
import type { Auth } from "../types";
import { ApiError } from "./errors";
import { hmacHex, safeEqual } from "./crypto";
import { newId, newToken, sha256Hex } from "./ids";
import { leadPurgeStatements } from "./lead-purge";
import { leadSearchMergeSql, leadSearchValues } from "./lead-search";
import { IMPORT_CHUNK_ROWS, IMPORT_TTL_MS, type ImportContext, type ImportJob, type ImportReceipt, type ImportRow } from "../../shared/lead-imports";

export type CreateImport = { requestId: string; requestedAt: number; fingerprint: string; totalRows: number; consentConfirmed: true };
export type ApplyImport = { generation: string; chunkNo: number; rows: ImportRow[]; consentConfirmed: true };
type Job = { id: string; workspace_id: string; user_id: string; session_id: string; requested_at: number; fingerprint: string; generation: string; status: "active" | "completed" | "cancelled"; total_rows: number; next_chunk: number; processed_rows: number; imported_rows: number; invalid_rows: number; skipped_rows: number; birth_revision: number; privacy_epoch: number; current_epoch: number; expires_at: number };
const actorSql = `EXISTS(SELECT 1 FROM sessions se JOIN users u ON u.id=se.user_id JOIN members m ON m.user_id=u.id AND m.workspace_id=se.current_workspace_id
  WHERE se.id=? AND se.user_id=? AND se.expires_at>? AND se.current_workspace_id=? AND u.phone_verified_at IS NOT NULL AND m.role IN ('owner','editor'))`;
const actorParams = (auth: Auth, workspaceId: string, at: number) => [auth.sessionId, auth.user.id, at, workspaceId] as const;
const changed = () => new ApiError(409, "import_changed", "리드 삭제 상태나 가져오기 상태가 바뀌었어요. 완료된 행은 유지돼요. 확인 후 새 작업으로 시작해 주세요.");
const expired = () => new ApiError(410, "import_expired", "가져오기를 시작한 지 24시간이 지났어요. 완료된 행은 유지돼요. 파일과 동의를 다시 확인해 새로 시작해 주세요.");
const assertion = (condition: string) => `SELECT json(CASE WHEN ${condition} THEN 'true' ELSE 'lead_import_context_changed' END)`;

export async function importContext(env: Env, auth: Auth, workspaceId: string): Promise<ImportContext> {
  if (!(await env.DB.prepare(`SELECT 1 WHERE ${actorSql}`).bind(...actorParams(auth, workspaceId, Date.now())).first())) throw new ApiError(403, "forbidden", "현재 워크스페이스의 소유자·편집자만 가져올 수 있어요.");
  const scope = JSON.stringify(["lead-import", auth.user.id, auth.sessionId, workspaceId]);
  return { scope: await sha256Hex(scope), csrfToken: await hmacHex(env.TOKEN_ENC_KEY || auth.sessionId, scope), serverTime: Date.now() };
}
export async function requireImportCsrf(env: Env, auth: Auth, workspaceId: string, origin?: string, token?: string) {
  const expected = await hmacHex(env.TOKEN_ENC_KEY || auth.sessionId, JSON.stringify(["lead-import", auth.user.id, auth.sessionId, workspaceId]));
  if (origin !== new URL(env.APP_URL).origin || !token || !safeEqual(token, expected)) throw new ApiError(403, "csrf_invalid", "요청을 확인하지 못했어요. 화면을 다시 열어 주세요.");
}
function publicJob(job: Job): ImportJob {
  const status = job.expires_at <= Date.now() ? "expired" : job.status === "active" && job.privacy_epoch !== job.current_epoch ? "blocked" : job.status;
  return { id: job.id, generation: job.generation, fingerprint: job.fingerprint, status, totalRows: job.total_rows, nextChunk: job.next_chunk, processed: job.processed_rows, imported: job.imported_rows, invalid: job.invalid_rows, skipped: job.skipped_rows, expiresAt: job.expires_at };
}
async function readJob(env: Env, auth: Auth, workspaceId: string, id: string): Promise<Job> {
  const job = await env.DB.prepare(`SELECT j.*,k.privacy_epoch AS current_epoch FROM lead_import_jobs j JOIN lead_import_clocks k ON k.workspace_id=j.workspace_id
    WHERE j.id=? AND j.workspace_id=? AND j.user_id=? AND j.session_id=? AND ${actorSql}`)
    .bind(id, workspaceId, auth.user.id, auth.sessionId, ...actorParams(auth, workspaceId, Date.now())).first<Job>();
  if (!job) throw new ApiError(404, "import_not_found", "이 로그인과 워크스페이스의 가져오기를 찾을 수 없어요.");
  return job;
}
export async function getImportJob(env: Env, auth: Auth, workspaceId: string, id: string) { return publicJob(await readJob(env, auth, workspaceId, id)); }
export async function createImportJob(env: Env, auth: Auth, workspaceId: string, input: CreateImport): Promise<ImportJob> {
  const at = Date.now();
  if (input.requestedAt > at || input.requestedAt <= at - IMPORT_TTL_MS) throw expired();
  await env.DB.batch([
    env.DB.prepare(assertion(actorSql)).bind(...actorParams(auth, workspaceId, at)),
    env.DB.prepare("INSERT INTO lead_import_clocks(workspace_id) VALUES(?) ON CONFLICT DO NOTHING").bind(workspaceId),
    env.DB.prepare(`INSERT INTO lead_import_jobs(id,workspace_id,user_id,session_id,requested_at,fingerprint,generation,status,total_rows,birth_revision,privacy_epoch,created_at,expires_at,updated_at)
      SELECT ?,?,?,?,?,?,?,'active',?,revision,privacy_epoch,?,?,? FROM lead_import_clocks WHERE workspace_id=? ON CONFLICT(id) DO NOTHING`)
      .bind(input.requestId, workspaceId, auth.user.id, auth.sessionId, input.requestedAt, input.fingerprint, newToken(18), input.totalRows, at, input.requestedAt + IMPORT_TTL_MS, at, workspaceId),
  ]);
  const job = await readJob(env, auth, workspaceId, input.requestId);
  if (job.fingerprint !== input.fingerprint || job.total_rows !== input.totalRows || job.requested_at !== input.requestedAt) throw new ApiError(409, "import_request_reused", "같은 가져오기 요청의 파일이나 행 수가 달라요.");
  return publicJob(job);
}
export async function cancelImportJob(env: Env, auth: Auth, workspaceId: string, id: string, generation: string) {
  const at = Date.now();
  const result = await env.DB.prepare(`UPDATE lead_import_jobs SET status='cancelled',generation=?,updated_at=? WHERE id=? AND workspace_id=? AND user_id=? AND session_id=? AND generation=? AND status='active' AND ${actorSql} RETURNING id`)
    .bind(newToken(18), at, id, workspaceId, auth.user.id, auth.sessionId, generation, ...actorParams(auth, workspaceId, at)).first();
  if (!result) throw changed();
  return getImportJob(env, auth, workspaceId, id);
}
type Input = { index: number; email: string; hash: string; name: string | null; company: string | null; phone: string | null; optIn: number; id: string; unsubscribe: string };
const blank = (value?: string) => value?.trim() || null;
const optIn = /^(y|yes|true|1|o|동의|예)$/i;
async function prepareRows(rows: ImportRow[]) {
  const invalid: number[] = [], valid: Input[] = [], unique = new Map<string, Input>();
  for (const [index, row] of rows.entries()) {
    const email = row.email.trim().toLowerCase();
    if (!z.email().safeParse(email).success) { invalid.push(index); continue; }
    const value: Input = { index, email, hash: await sha256Hex(email), name: blank(row.name), company: blank(row.company), phone: blank(row.phone), optIn: optIn.test((row.marketing_opt_in ?? "").trim()) ? 1 : 0, id: newId(), unsubscribe: newToken() };
    valid.push(value);
    const prev = unique.get(email);
    if (prev) unique.set(email, { ...prev, name: value.name ?? prev.name, company: value.company ?? prev.company, phone: value.phone ?? prev.phone, optIn: Math.max(value.optIn, prev.optIn) });
    else unique.set(email, value);
  }
  return { invalid, valid, unique: [...unique.values()].map((value) => ({ ...value, ...leadSearchValues(value) })) };
}
async function receipt(env: Env, auth: Auth, workspaceId: string, id: string, input: ApplyImport, digest: string): Promise<ImportReceipt | null> {
  const row = await env.DB.prepare(`SELECT c.digest,c.result_json FROM lead_import_chunks c JOIN lead_import_jobs j ON j.id=c.job_id
    WHERE j.id=? AND j.workspace_id=? AND j.user_id=? AND j.session_id=? AND j.generation=? AND j.status IN ('active','completed') AND j.expires_at>?
    AND c.chunk_no=? AND c.status='done' AND ${actorSql}`)
    .bind(id, workspaceId, auth.user.id, auth.sessionId, input.generation, Date.now(), input.chunkNo, ...actorParams(auth, workspaceId, Date.now())).first<{ digest: string; result_json: string }>();
  if (!row) return null;
  if (row.digest !== digest) throw new ApiError(409, "import_chunk_reused", "완료된 묶음의 내용이 달라요. 원래 파일과 열 매핑으로 다시 선택해 주세요.");
  return JSON.parse(row.result_json) as ImportReceipt;
}
export async function applyImportChunk(env: Env, auth: Auth, workspaceId: string, id: string, input: ApplyImport): Promise<ImportReceipt> {
  const job = await readJob(env, auth, workspaceId, id);
  if (job.expires_at <= Date.now()) throw expired();
  if (job.generation !== input.generation || job.status === "cancelled") throw changed();
  const digest = await sha256Hex(JSON.stringify(input.rows.map((row) => [row.email, row.name ?? null, row.company ?? null, row.phone ?? null, row.marketing_opt_in ?? null])));
  const previous = await receipt(env, auth, workspaceId, id, input, digest);
  if (previous) return previous;
  if (job.status !== "active" || job.privacy_epoch !== job.current_epoch || input.chunkNo !== job.next_chunk) throw changed();
  if (input.rows.length !== Math.min(IMPORT_CHUNK_ROWS, job.total_rows - job.processed_rows)) throw new ApiError(400, "import_chunk_size", "현재 가져오기에 맞는 행 묶음을 보내 주세요.");
  const data = await prepareRows(input.rows), valid = JSON.stringify(data.valid.map(({ index, email }) => ({ index, email }))), unique = JSON.stringify(data.unique);
  // Force the bounded input as the outer loop; do not scan a growing workspace
  // once per row. The epoch assertion below rejects a deletion after this read.
  const tombstones = await env.DB.prepare(`SELECT 1 FROM json_each(?) i CROSS JOIN leads l ON l.workspace_id=? AND l.email=json_extract(i.value,'$.email') WHERE l.deleted_at IS NOT NULL LIMIT 1`).bind(unique, workspaceId).first();
  const at = Date.now(), token = newToken(24);
  const ownedSql = "SELECT c.* FROM lead_import_chunks c WHERE c.job_id=? AND c.chunk_no=? AND c.claim_token=? AND c.status='applying'";
  const ownedParams = [id, input.chunkNo, token] as const;
  const owned = `WITH owned AS (${ownedSql}) `;
  const eligible = "NOT EXISTS(SELECT 1 FROM json_each(c.skipped_json) skipped WHERE skipped.value=json_extract(i.value,'$.index'))";
  const source = JSON.stringify({ type: "import", guideId: null, influencerId: null, channelKey: null, linkId: null, at });
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO lead_import_chunks(job_id,chunk_no,digest,claim_token,status,invalid_json,skipped_json)
      SELECT j.id,?,?,?,'applying',?,(SELECT json_group_array(json_extract(i.value,'$.index')) FROM json_each(?) i
        CROSS JOIN leads l ON l.workspace_id=j.workspace_id AND l.email=json_extract(i.value,'$.email') LEFT JOIN lead_import_births b ON b.lead_id=l.id AND b.workspace_id=l.workspace_id
        WHERE (b.lead_id IS NULL OR b.revision>j.birth_revision) AND NOT EXISTS(SELECT 1 FROM lead_import_owned v WHERE v.job_id=j.id AND v.lead_id=l.id))
      FROM lead_import_jobs j JOIN lead_import_clocks k ON k.workspace_id=j.workspace_id
      WHERE j.id=? AND j.workspace_id=? AND j.user_id=? AND j.session_id=? AND j.generation=? AND j.status='active' AND j.expires_at>?
      AND j.privacy_epoch=k.privacy_epoch AND j.next_chunk=? AND j.total_rows-j.processed_rows>=? AND ${actorSql} ON CONFLICT(job_id,chunk_no) DO NOTHING`)
      .bind(input.chunkNo, digest, token, JSON.stringify(data.invalid), valid, id, workspaceId, auth.user.id, auth.sessionId, input.generation, at, input.chunkNo, input.rows.length, ...actorParams(auth, workspaceId, at)),
    env.DB.prepare(assertion(`EXISTS(${ownedSql})`)).bind(...ownedParams),
  ];
  // The assertion above proves epoch/actor once inside this atomic batch. The
  // purge's own DELETE trigger changes the epoch; later writes use only our claim.
  const selection = `SELECT l.id,l.workspace_id,json_extract(i.value,'$.hash') AS email_hash FROM json_each(?) i CROSS JOIN leads l ON l.email=json_extract(i.value,'$.email')
    JOIN lead_import_chunks c ON c.job_id=? AND c.chunk_no=? AND c.claim_token=? AND c.status='applying'
    WHERE l.workspace_id=? AND l.deleted_at IS NOT NULL AND ${eligible}`;
  if (tombstones) statements.push(...leadPurgeStatements(env.DB, selection, [unique, ...ownedParams, workspaceId]).map((entry) => entry.statement));
  statements.push(
    env.DB.prepare(`${owned} INSERT INTO leads(id,workspace_id,email,name,company,phone,answers,marketing_opt_in,alimtalk_opt_in,unsubscribe_token,first_source,last_source,email_hash,created_at)
      SELECT json_extract(i.value,'$.id'),?,json_extract(i.value,'$.email'),json_extract(i.value,'$.name'),json_extract(i.value,'$.company'),json_extract(i.value,'$.phone'),'{}',json_extract(i.value,'$.optIn'),0,json_extract(i.value,'$.unsubscribe'),?,?,json_extract(i.value,'$.hash'),?
      FROM json_each(?) i JOIN owned c WHERE ${eligible}
      ON CONFLICT(workspace_id,email) DO UPDATE SET name=coalesce(excluded.name,leads.name),company=coalesce(excluded.company,leads.company),phone=coalesce(excluded.phone,leads.phone),marketing_opt_in=max(leads.marketing_opt_in,excluded.marketing_opt_in),last_source=excluded.last_source,email_hash=excluded.email_hash
      WHERE leads.deleted_at IS NULL`).bind(...ownedParams, workspaceId, source, source, at, unique),
    // Bound the UPDATE target to this chunk as well as its input. Otherwise the
    // planner can scan the whole live workspace once for each JSON input row.
    env.DB.prepare(`WITH owned AS (${ownedSql}), input AS MATERIALIZED(SELECT value FROM json_each(?))
      UPDATE leads AS l SET ${leadSearchMergeSql("i.value", "l")}
      FROM input i JOIN owned c WHERE l.workspace_id=? AND l.email=json_extract(i.value,'$.email')
      AND (l.workspace_id,l.email) IN(SELECT ?,json_extract(value,'$.email') FROM input)
      AND l.deleted_at IS NULL AND ${eligible}`).bind(...ownedParams, unique, workspaceId, workspaceId),
    env.DB.prepare(`${owned} INSERT INTO lead_import_owned(job_id,lead_id) SELECT c.job_id,l.id FROM owned c CROSS JOIN json_each(?) i CROSS JOIN leads l ON l.id=json_extract(i.value,'$.id') AND l.workspace_id=? WHERE ${eligible} ON CONFLICT DO NOTHING`).bind(...ownedParams, unique, workspaceId),
    env.DB.prepare(`${owned} INSERT INTO lead_sources(id,lead_id,type,at)
      SELECT 'lead_import:'||c.job_id||':'||?||':'||c.chunk_no||':'||json_extract(i.value,'$.index'),l.id,'import',?
      FROM owned c CROSS JOIN json_each(?) i CROSS JOIN leads l ON l.workspace_id=? AND l.email=json_extract(i.value,'$.email') WHERE ${eligible} ON CONFLICT(id) DO NOTHING`)
      .bind(...ownedParams, job.generation, at, valid, workspaceId),
    env.DB.prepare(`${owned} INSERT INTO events(id,workspace_id,name,props,at)
      SELECT 'lead_import:'||c.job_id||':'||?||':'||c.chunk_no,?,'lead_imported',json_object('rows',?-json_array_length(c.skipped_json)),? FROM owned c`)
      .bind(...ownedParams, job.generation, workspaceId, data.valid.length, at),
    env.DB.prepare(`${owned} UPDATE lead_import_jobs AS j SET next_chunk=next_chunk+1,processed_rows=processed_rows+?,imported_rows=imported_rows+?-json_array_length(c.skipped_json),invalid_rows=invalid_rows+?,skipped_rows=skipped_rows+json_array_length(c.skipped_json),
      status=CASE WHEN processed_rows+?=total_rows THEN 'completed' ELSE 'active' END,privacy_epoch=(SELECT privacy_epoch FROM lead_import_clocks WHERE workspace_id=j.workspace_id),updated_at=?
      FROM owned c WHERE j.id=c.job_id`).bind(...ownedParams, input.rows.length, data.valid.length, data.invalid.length, input.rows.length, at),
    env.DB.prepare(`${owned} UPDATE lead_import_chunks AS target SET status='done',claim_token=NULL,result_json=(
      SELECT json_object('chunkNo',c.chunk_no,'imported',?-json_array_length(c.skipped_json),'invalid',json(c.invalid_json),'skipped',json(c.skipped_json),
        'job',json_object('id',j.id,'generation',j.generation,'fingerprint',j.fingerprint,'status',j.status,'totalRows',j.total_rows,'nextChunk',j.next_chunk,'processed',j.processed_rows,'imported',j.imported_rows,'invalid',j.invalid_rows,'skipped',j.skipped_rows,'expiresAt',j.expires_at))
      FROM owned c JOIN lead_import_jobs j ON j.id=c.job_id) WHERE target.job_id=? AND target.chunk_no=? AND target.claim_token=?`)
      .bind(...ownedParams, data.valid.length, ...ownedParams),
    env.DB.prepare("SELECT result_json FROM lead_import_chunks WHERE job_id=? AND chunk_no=? AND digest=? AND status='done'").bind(id, input.chunkNo, digest),
  );
  try {
    const results = await env.DB.batch(statements);
    const result = results.at(-1)!.results[0] as { result_json: string } | undefined;
    if (!result) throw new Error("receipt_missing");
    return JSON.parse(result.result_json) as ImportReceipt;
  } catch {
    // A commit response may be lost. Read the exact receipt; never replay writes
    // automatically, create a fresh job, or leak D1's bound contact values.
    const completed = await receipt(env, auth, workspaceId, id, input, digest);
    if (completed) return completed;
    const current = await readJob(env, auth, workspaceId, id);
    if (current.expires_at <= Date.now()) throw expired();
    if (current.generation !== input.generation || current.status !== "active" || current.privacy_epoch !== current.current_epoch || current.next_chunk !== input.chunkNo) throw changed();
    throw new ApiError(503, "import_unconfirmed", "이 묶음의 완료를 확인하지 못했어요. 같은 파일로 다시 확인해 주세요. 완료된 묶음은 중복 적용하지 않아요.");
  }
}
export async function cleanupLeadImports(env: Env): Promise<void> {
  try { await env.DB.batch([env.DB.prepare("DELETE FROM lead_import_jobs WHERE id IN(SELECT id FROM lead_import_jobs WHERE expires_at<=? ORDER BY expires_at,id LIMIT 1000)").bind(Date.now())]); }
  catch { throw new Error("lead_import_cleanup_failed"); }
}
