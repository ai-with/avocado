import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { newId, newToken, now } from "../lib/ids";
import { events } from "../db/schema";
import { assertMediaWritable } from "../lib/media-purge";
import type { Ctx } from "./context";

const dialect = new SQLiteSyncDialect();
const CLAIM_MS = 15 * 60 * 1000;
export class StaleAnalysis extends Error { constructor() { super("stale_analysis"); } }
export async function audioHash(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
}
export const writableSql = (id: string) => sql`EXISTS(SELECT 1 FROM submissions s JOIN consents c ON c.id=s.consent_id AND c.guide_influencer_id=s.guide_influencer_id
 WHERE s.id=${id} AND c.withdrawn_at IS NULL AND s.media_purged_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM media_purges p WHERE p.submission_id=s.id))`;
function scope(ctx: Ctx): SQL {
  const claim = ctx.analysis;
  return claim ? sql`${writableSql(ctx.sub.id)} AND EXISTS(SELECT 1 FROM submission_analysis a WHERE a.submission_id=${ctx.sub.id}
    AND a.generation=${claim.generation} AND a.claim_token=${claim.token} AND a.claim_until>${now()})` : writableSql(ctx.sub.id);
}
export async function assertCurrentAnalysis(ctx: Ctx) {
  if (!(await ctx.db.get(sql`SELECT 1 WHERE ${scope(ctx)}`))) {
    await assertMediaWritable(ctx.db, ctx.sub.id);
    throw new StaleAnalysis();
  }
}
export async function analysisWrite(ctx: Ctx, statements: SQLWrapper[]) {
  const queries = [sql`SELECT CASE WHEN (${scope(ctx)}) THEN 1 ELSE json('analysis_guard_failed') END`, ...statements];
  try {
    return await analysisSqlBatch(ctx.env.DB, queries);
  } catch {
    await assertCurrentAnalysis(ctx);
    throw new Error("analysis_write_failed");
  }
}
export function analysisSqlBatch(db: D1Database, statements: SQLWrapper[]) {
  return db.batch(statements.map((statement) => {
    const query = dialect.sqlToQuery(statement.getSQL());
    return db.prepare(query.sql).bind(...query.params);
  }));
}
// These pipeline counters have no notification/participation event hooks.
// Store them with the fenced result rather than issuing another DB call.
export function processingEvent(ctx: Ctx, name: "processing_job_completed" | "processing_job_failed" | "stt_language_detected" | "violation_candidates_generated", props: Record<string, unknown>) {
  return ctx.db.insert(events).values({ id: newId(), workspaceId: ctx.workspaceId, name, props, at: now() });
}
export async function claimAnalysis(ctx: Ctx, requestId: string | null) {
  const token = newToken(), at = now();
  const rows = await ctx.db.all<{ generation: number; completed_generation: number }>(sql`UPDATE submission_analysis SET claim_token=${token},claim_until=${at + CLAIM_MS}
    WHERE submission_id=${ctx.sub.id} AND ${writableSql(ctx.sub.id)} AND (claim_token IS NULL OR claim_until<=${at})
    AND ((${requestId} IS NULL AND completed_generation<generation) OR (${requestId} IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM submission_analysis_retries r WHERE r.submission_id=${ctx.sub.id} AND r.request_id=${requestId} AND r.completed_at IS NOT NULL))) RETURNING generation,completed_generation`);
  if (rows[0]) { ctx.analysis = { generation: rows[0].generation, token, requestId, pendingGeneration: rows[0].completed_generation < rows[0].generation }; return "claimed" as const; }
  await assertMediaWritable(ctx.db, ctx.sub.id);
  const state = await ctx.db.get<{ claim_token: string | null; claim_until: number | null }>(sql`SELECT claim_token,claim_until FROM submission_analysis WHERE submission_id=${ctx.sub.id}`);
  return state?.claim_token && (state.claim_until ?? 0) > at ? "busy" as const : "done" as const;
}
export async function renewAnalysis(ctx: Ctx) {
  await analysisWrite(ctx, [sql`UPDATE submission_analysis SET claim_until=${now() + CLAIM_MS} WHERE submission_id=${ctx.sub.id}`]);
}
export async function releaseAnalysis(ctx: Ctx) {
  if (!ctx.analysis) return;
  await ctx.db.run(sql`UPDATE submission_analysis SET claim_token=NULL,claim_until=NULL WHERE submission_id=${ctx.sub.id}
    AND generation=${ctx.analysis.generation} AND claim_token=${ctx.analysis.token} AND ${writableSql(ctx.sub.id)}`);
}
export async function finishAnalysis(ctx: Ctx, performed = true) {
  await analysisWrite(ctx, [sql`UPDATE submissions SET status='ready' WHERE id=${ctx.sub.id}`,
    sql`UPDATE submission_analysis_retries SET completed_at=coalesce(completed_at,${now()}) WHERE submission_id=${ctx.sub.id} AND request_id=${ctx.analysis?.requestId ?? null}`,
    sql`UPDATE submission_analysis SET completed_generation=CASE WHEN ${ctx.analysis?.requestId ?? null} IS NULL THEN generation ELSE completed_generation END,
    completed_request_id=CASE WHEN ${performed ? 1 : 0}=1 THEN coalesce(${ctx.analysis?.requestId ?? null},completed_request_id)
      ELSE coalesce(completed_request_id,${ctx.analysis?.requestId ?? null}) END,claim_token=NULL,claim_until=NULL WHERE submission_id=${ctx.sub.id}`]);
}
