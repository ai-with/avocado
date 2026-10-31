import { sql } from "drizzle-orm";
import { getDb, type Db } from "../db";
import type { Auth } from "../types";
import type { GoogleSheetsExportStatus } from "../db/schema/google-sheets";
import { parseCsv } from "../../shared/csv";
import { performanceCells, performanceRows } from "../routes/performance";
import { filteredLeads, lookups } from "../routes/leads/shared";
import { leadsCsv } from "../routes/leads/export";
import { encryptToken, decryptToken } from "./crypto";
import { newId, now, sha256Hex } from "./ids";
import { ApiError } from "./errors";
import { assertSheetsAccess, requireSheetsConfigured, sheetsAccessPredicate, sheetsAccessToken, sheetsConnection } from "./google-sheets-auth";
import { createExportSpreadsheet, SheetsProviderError, writeExportSpreadsheet, type SheetsValues } from "./google-sheets-provider";

export const SHEETS_MAX_ROWS = 1000;
const MAX_PAYLOAD_BYTES = 512 * 1024;
const STALE_MS = 15 * 60_000;
const RETENTION_MS = 24 * 3600_000;
type Kind = "leads" | "performance";
type Request = { requestId: string; connectionGeneration: string; kind: Kind; filters: Record<string, string> };
type Job = { id: string; userId: string; workspaceId: string; requestId: string; kind: Kind; filtersHash: string; generation: string; status: GoogleSheetsExportStatus; payloadEnc: string | null; rowCount: number; title: string; spreadsheetId: string | null; errorCode: string | null; createdAt: number; updatedAt: number };
const jobColumns = sql.raw("id,user_id AS userId,workspace_id AS workspaceId,request_id AS requestId,kind,filters_hash AS filtersHash,connection_generation AS generation,status,payload_enc AS payloadEnc,row_count AS rowCount,title,spreadsheet_id AS spreadsheetId,error_code AS errorCode,created_at AS createdAt,updated_at AS updatedAt");
const FILTERS: Record<Kind, string[]> = { performance: ["guideId", "influencerId", "format"], leads: ["sourceType", "guideId", "influencerId", "channelKey", "tagId", "marketing", "alimtalk", "groupId", "q", "contentLinkId"] };

function normalizedFilters(kind: Kind, filters: Record<string, string>) {
  if (Object.keys(filters).some((key) => !FILTERS[kind].includes(key))) throw new ApiError(400, "export_filter_invalid", "내보내기 필터를 확인해 주세요.");
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== "").sort(([a], [b]) => a.localeCompare(b)));
}

async function assertFilterOwnership(db: Db, workspaceId: string, filters: Record<string, string>) {
  const resources = [["guideId", "guides"], ["influencerId", "influencers"], ["tagId", "lead_tags"], ["groupId", "lead_groups"], ["contentLinkId", "short_links"]] as const;
  const checks = resources.filter(([key]) => filters[key]).map(([key, table]) => sql`SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ${sql.raw(table)} WHERE id=${filters[key]!} AND workspace_id=${workspaceId})`);
  if (checks.length && (await db.all(sql.join(checks, sql` UNION ALL `))).length) throw new ApiError(404, "export_filter_not_found", "현재 워크스페이스의 필터를 골라 주세요.");
}

// 공통 CSV 행 선택은 유지하되, 그 함수가 읽는 입력 원장과 lookup에도 명시적 상한을 둔다.
async function assertSourceBounds(db: Db, workspaceId: string, kind: Kind, filters: Record<string, string>) {
  const lengths = (columns: string[]) => sql.raw(columns.map((column) => `coalesce(length(CAST(${column} AS BLOB)),0)`).join("+"));
  const profileBytes = lengths(["email", "name", "company", "phone", "answers", "unsubscribe_token", "first_source", "last_source", "email_hash", "id", "workspace_id"]);
  const contentBytes = lengths(["c.id", "c.guide_id", "c.influencer_id", "c.guide_influencer_id", "c.url", "c.ig_media_id", "c.format", "c.posted_at_source", "c.url_submitted_by", "c.conflict_url", "c.thumbnail_url", "c.thumbnail_key"]);
  const [counts] = await db.all<Record<string, number>>(sql`SELECT
    (SELECT count(*) FROM leads WHERE workspace_id=${workspaceId} AND deleted_at IS NULL) AS leads,
    (SELECT count(*) FROM lead_sources s JOIN leads l ON l.id=s.lead_id WHERE l.workspace_id=${workspaceId} AND l.deleted_at IS NULL) AS sources,
    (SELECT count(*) FROM lead_tag_links x JOIN lead_tags t ON t.id=x.tag_id WHERE t.workspace_id=${workspaceId}) AS tagLinks,
    (SELECT count(*) FROM short_links WHERE workspace_id=${workspaceId}) AS links,
    (SELECT count(*) FROM guides WHERE workspace_id=${workspaceId}) AS guides,
    (SELECT count(*) FROM influencers WHERE workspace_id=${workspaceId}) AS influencers,
    (SELECT count(*) FROM lead_tags WHERE workspace_id=${workspaceId}) AS tags,
    (SELECT count(*) FROM link_channels WHERE workspace_id=${workspaceId}) AS channels,
    (SELECT count(*) FROM ig_connections WHERE workspace_id=${workspaceId} AND target='influencer' AND revoked_at IS NULL AND connected_at IS NOT NULL) AS connections,
    ${kind === "leads" ? sql`(SELECT coalesce(sum(${profileBytes}),0) FROM leads WHERE workspace_id=${workspaceId} AND deleted_at IS NULL)` : sql`(SELECT coalesce(sum(${contentBytes}),0) FROM contents c JOIN guides g ON g.id=c.guide_id WHERE g.workspace_id=${workspaceId} AND c.deleted_at IS NULL
      ${filters.guideId ? sql`AND c.guide_id=${filters.guideId}` : sql``} ${filters.influencerId ? sql`AND c.influencer_id=${filters.influencerId}` : sql``} ${filters.format ? sql`AND c.format=${filters.format}` : sql``})`} AS sourceBytes,
    (SELECT coalesce(sum(length(CAST(rules AS BLOB))+length(CAST(name AS BLOB))),0) FROM lead_groups WHERE workspace_id=${workspaceId} AND id=${filters.groupId ?? ""}) AS groupBytes,
    (SELECT coalesce(sum(${lengths(["id", "name"])}),0) FROM guides WHERE workspace_id=${workspaceId})
      +(SELECT coalesce(sum(${lengths(["id", "display_name", "ig_handle"])}),0) FROM influencers WHERE workspace_id=${workspaceId})
      +(SELECT coalesce(sum(${lengths(["id", "workspace_id", "name"])}),0) FROM lead_tags WHERE workspace_id=${workspaceId})
      +(SELECT coalesce(sum(${lengths(["id", "workspace_id", "key", "name"])}),0) FROM link_channels WHERE workspace_id=${workspaceId})
      +(SELECT coalesce(sum(${lengths(["id", "guide_id", "influencer_id", "content_label"])}),0) FROM short_links WHERE workspace_id=${workspaceId})
      +(SELECT coalesce(sum(${lengths(["s.lead_id", "s.type", "s.guide_id", "s.influencer_id", "s.channel_key", "s.link_id"])}),0) FROM lead_sources s JOIN leads l ON l.id=s.lead_id WHERE l.workspace_id=${workspaceId} AND l.deleted_at IS NULL)
      +(SELECT coalesce(sum(${lengths(["x.lead_id", "x.tag_id"])}),0) FROM lead_tag_links x JOIN lead_tags t ON t.id=x.tag_id WHERE t.workspace_id=${workspaceId}) AS metadataBytes`);
  const { sourceBytes = 0, groupBytes = 0, metadataBytes = 0, ...rowCounts } = counts ?? {};
  if (sourceBytes + metadataBytes + groupBytes > 8 * 1024 * 1024 || groupBytes > 128 * 1024 || Object.entries(rowCounts).some(([key, count]) => count > (["sources", "tagLinks"].includes(key) ? 20_000 : 5000))) throw new ApiError(413, "export_source_too_large", "이 워크스페이스는 자료가 많아 CSV로 내보내 주세요.");
}

export async function sheetsExportValues(db: Db, workspaceId: string, kind: Kind, filters: Record<string, string>): Promise<SheetsValues> {
  await assertFilterOwnership(db, workspaceId, filters);
  await assertSourceBounds(db, workspaceId, kind, filters);
  let values: SheetsValues;
  if (kind === "performance") values = performanceCells(await performanceRows(db, workspaceId, filters, SHEETS_MAX_ROWS));
  else {
    const rows = await filteredLeads(db, workspaceId, filters);
    if (rows.length > SHEETS_MAX_ROWS) throw new ApiError(413, "export_too_many_rows", "필터를 좁혀 1,000행 이하로 내보내 주세요.");
    values = parseCsv(leadsCsv(rows, await lookups(db, workspaceId)));
  }
  if (values.length > SHEETS_MAX_ROWS + 1 || values.some((row) => row.some((value) => String(value).length > 50_000)) || new TextEncoder().encode(JSON.stringify(values)).byteLength > MAX_PAYLOAD_BYTES) throw new ApiError(413, "export_payload_too_large", "내보낼 자료가 커요. 필터를 더 좁히거나 CSV로 내보내 주세요.");
  return values;
}

async function readJob(db: Db, id: string, auth: Auth, workspaceId: string) {
  return (await db.all<Job>(sql`SELECT ${jobColumns} FROM google_sheets_exports WHERE id=${id} AND user_id=${auth.user.id} AND workspace_id=${workspaceId}`))[0] ?? null;
}
const canRetry = (job: Job) => job.status === "failed" && Boolean(job.payloadEnc) && (job.spreadsheetId ? job.errorCode === "write_failed" : job.errorCode === "google_unavailable");
function publicJob(job: Job) {
  return { id: job.id, status: job.status, rows: job.rowCount, title: job.title, retryable: canRetry(job), errorCode: job.errorCode,
    ...(job.spreadsheetId && { spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${job.spreadsheetId}/edit` }) };
}

async function settleStale(db: Db, job: Job) {
  if (["creating", "writing"].includes(job.status) && job.updatedAt < now() - STALE_MS) {
    await db.run(sql`UPDATE google_sheets_exports SET status=${job.spreadsheetId ? "failed" : "unknown"},error_code=${job.spreadsheetId ? "write_failed" : "create_unknown"},updated_at=${now()}
      WHERE id=${job.id} AND status=${job.status} AND updated_at=${job.updatedAt}`);
  }
}

export async function getSheetsExport(db: Db, auth: Auth, workspaceId: string, id: string) {
  const job = await readJob(db, id, auth, workspaceId);
  if (!job) throw new ApiError(404, "export_not_found", "내보내기 기록을 찾을 수 없어요.");
  await settleStale(db, job);
  return publicJob((await readJob(db, id, auth, workspaceId))!);
}

export async function startSheetsExport(env: Env, db: Db, auth: Auth, workspaceId: string, input: Request) {
  requireSheetsConfigured(env);
  const filters = normalizedFilters(input.kind, input.filters);
  const filtersHash = await sha256Hex(JSON.stringify([input.kind, filters]));
  let job = (await db.all<Job>(sql`SELECT ${jobColumns} FROM google_sheets_exports WHERE user_id=${auth.user.id} AND request_id=${input.requestId}`))[0];
  if (!job) {
    const connection = await sheetsConnection(db, auth.user.id);
    if (!connection?.accessEnc || connection.revokedAt !== null) throw new ApiError(409, "google_sheets_not_connected", "Google 계정을 먼저 연결해 주세요.");
    if (connection.generation !== input.connectionGeneration) throw new ApiError(409, "connection_changed", "연결된 Google 계정이 바뀌었어요. 연결 상태를 새로 확인해 주세요.");
    const values = await sheetsExportValues(db, workspaceId, input.kind, filters);
    const id = newId(), at = now();
    const title = `${input.kind === "leads" ? "리드" : "성과"} 내보내기 ${new Date(at).toISOString().slice(0, 10)} [${id.slice(0, 8)}]`;
    await db.run(sql`INSERT INTO google_sheets_exports (id,user_id,workspace_id,request_id,kind,filters_hash,connection_generation,status,payload_enc,row_count,title,created_at,updated_at)
      SELECT ${id},${auth.user.id},${workspaceId},${input.requestId},${input.kind},${filtersHash},${input.connectionGeneration},'prepared',${await encryptToken(env.TOKEN_ENC_KEY!, JSON.stringify(values))},${values.length - 1},${title},${at},${at}
      WHERE ${sheetsAccessPredicate(auth, workspaceId, input.connectionGeneration)} ON CONFLICT(user_id,request_id) DO NOTHING`);
    job = (await db.all<Job>(sql`SELECT ${jobColumns} FROM google_sheets_exports WHERE user_id=${auth.user.id} AND request_id=${input.requestId}`))[0];
    if (!job) throw new ApiError(409, "connection_changed", "연결 상태나 권한이 바뀌었어요. 화면을 새로 열어 확인해 주세요.");
  }
  if (job.generation !== input.connectionGeneration) throw new ApiError(409, "connection_changed", "이 내보내기를 시작한 Google 연결과 달라요. 연결 상태를 새로 확인해 주세요.");
  if (job.workspaceId !== workspaceId || job.kind !== input.kind || job.filtersHash !== filtersHash) throw new ApiError(409, "export_request_conflict", "같은 내보내기 요청의 필터가 바뀌었어요. 화면을 새로 열어 주세요.");
  await settleStale(db, job);
  job = (await readJob(db, job.id, auth, workspaceId))!;
  if (job.status !== "prepared" && !canRetry(job)) return publicJob(job);
  const phase = job.spreadsheetId ? "writing" : "creating";
  const claimed = await db.all<{ id: string }>(sql`UPDATE google_sheets_exports SET status=${phase},error_code=NULL,updated_at=${now()} WHERE id=${job.id} AND status=${job.status} AND updated_at=${job.updatedAt} RETURNING id`);
  if (!claimed.length) return publicJob((await readJob(db, job.id, auth, workspaceId))!);
  let creating = false;
  try {
    if (!job.payloadEnc || job.createdAt < now() - RETENTION_MS) throw new SheetsProviderError("export_expired");
    const values = JSON.parse(await decryptToken(env.TOKEN_ENC_KEY!, job.payloadEnc)) as SheetsValues;
    const token = await sheetsAccessToken(env, db, auth.user.id, job.generation);
    await assertSheetsAccess(db, auth, workspaceId, job.generation);
    if (!job.spreadsheetId) {
      creating = true;
      const id = await createExportSpreadsheet(token, job.title, values.length, values[0]!.length);
      // 생성 ID부터 영속화한다. 연결 해제가 겹쳐도 빈 파일을 찾을 수 있고 새 파일은 만들지 않는다.
      await db.run(sql`UPDATE google_sheets_exports SET spreadsheet_id=${id},updated_at=${now()} WHERE id=${job.id} AND spreadsheet_id IS NULL`);
      job.spreadsheetId = id;
    }
    creating = false;
    await assertSheetsAccess(db, auth, workspaceId, job.generation);
    const access = sheetsAccessPredicate(auth, workspaceId, job.generation);
    const active = await db.all<{ id: string }>(sql`UPDATE google_sheets_exports SET status='writing',updated_at=${now()} WHERE id=${job.id} AND status IN ('creating','writing') AND ${access} RETURNING id`);
    if (!active.length) throw new SheetsProviderError("connection_changed");
    await writeExportSpreadsheet(token, job.spreadsheetId, values);
    const finished = await db.all<{ id: string }>(sql`UPDATE google_sheets_exports SET status='done',payload_enc=NULL,error_code=NULL,updated_at=${now()} WHERE id=${job.id} AND status='writing' AND ${sheetsAccessPredicate(auth, workspaceId, job.generation)} RETURNING id`);
    if (!finished.length) throw new SheetsProviderError("connection_changed");
  } catch (error) {
    const code = error instanceof SheetsProviderError ? error.code : creating ? "create_unknown" : "google_unavailable";
    const unknown = creating && (!job.spreadsheetId && (!(error instanceof SheetsProviderError) || error.uncertain));
    await db.run(sql`UPDATE google_sheets_exports SET status=${unknown ? "unknown" : "failed"},error_code=${unknown ? "create_unknown" : code},updated_at=${now()} WHERE id=${job.id} AND status IN ('creating','writing')`);
  }
  return publicJob((await readJob(db, job.id, auth, workspaceId))!);
}

export async function cleanupGoogleSheetsJobs(env: Env) {
  const at = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM google_sheets_states WHERE expires_at<? OR used_at IS NOT NULL").bind(at),
    env.DB.prepare("UPDATE google_sheets_exports SET status=CASE WHEN spreadsheet_id IS NULL THEN 'unknown' ELSE 'failed' END,error_code=CASE WHEN spreadsheet_id IS NULL THEN 'create_unknown' ELSE 'write_failed' END,updated_at=? WHERE status IN ('creating','writing') AND updated_at<?").bind(at, at - STALE_MS),
    env.DB.prepare("UPDATE google_sheets_exports SET payload_enc=NULL,status=CASE WHEN status IN ('prepared','creating','writing') THEN 'failed' ELSE status END,error_code=CASE WHEN status IN ('prepared','creating','writing') THEN 'export_expired' ELSE error_code END WHERE created_at<? AND payload_enc IS NOT NULL").bind(at - RETENTION_MS),
  ]);
}
export async function enqueueGoogleSheetsCleanup(env: Env) { await env.PIPELINE.sendBatch([{ body: { type: "cleanup_google_sheets", payload: {} } }]); }
