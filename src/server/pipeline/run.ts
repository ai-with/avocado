import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { audioTracks, guideInfluencers, guides, processingJobs, submissions } from "../db/schema";
import { newId, now } from "../lib/ids";
import { JOB_STAGES, type JobStage } from "../../shared/review";
import { StageSkip, jobWhere, type Ctx } from "./context";
import { stageTranscribe } from "./stages/transcribe";
import { stageTranslate } from "./stages/translate";
import { stageDetect } from "./stages/detect";
import { stageNotify } from "./stages/notify";
import { mediaWritable } from "../lib/media-purge";
import { analysisWrite, claimAnalysis, finishAnalysis, processingEvent, releaseAnalysis, renewAnalysis, StaleAnalysis } from "./analysis";

// F-60 처리 파이프라인. Queue 메시지 { type: "process_submission", payload: { submissionId, stages? } }
// 단계마다 processing_jobs 1행을 갱신하고, 한 단계가 실패해도 다음 단계는 가능한 범위에서 계속한다

const payloadSchema = z.object({ submissionId: z.string(), stages: z.array(z.enum(JOB_STAGES)).optional(), requestId: z.string().max(100).optional() });
type Payload = z.infer<typeof payloadSchema>;
// 프레임·오디오는 업로드 완료 뒤 브라우저가 보내므로 큐 메시지가 먼저 올 수 있다. 오디오가 오거나 이 시간이 지날 때까지 다시 넣는다
const WAIT_FOR_ANALYSIS_MS = 3 * 60 * 1000;
const REQUEUE_DELAY_S = 20;
const ERROR_MAX_CHARS = 300;
const PROCESSABLE = ["uploaded", "processing", "ready", "failed"];

const STAGE_FNS: Record<JobStage, (ctx: Ctx) => Promise<string | null>> = {
  transcribe: stageTranscribe,
  translate: stageTranslate,
  detect: stageDetect,
  notify: stageNotify,
};

async function loadCtx(env: Env, db: Db, submissionId: string): Promise<Ctx | null> {
  const row = await db
    .select({ sub: submissions, gi: guideInfluencers, guide: guides })
    .from(submissions)
    .innerJoin(guideInfluencers, eq(guideInfluencers.id, submissions.guideInfluencerId))
    .innerJoin(guides, eq(guides.id, guideInfluencers.guideId))
    .where(eq(submissions.id, submissionId))
    .get();
  if (!row || !PROCESSABLE.includes(row.sub.status)) return null;
  return { env, db, sub: row.sub, guide: row.guide, workspaceId: row.guide.workspaceId, giId: row.gi.id };
}

// 전체 처리 요청인데 오디오가 아직 안 왔으면 잠시 뒤 다시 넣는다
async function requeueIfEarly(ctx: Ctx, payload: Payload) {
  if (payload.stages) return false;
  const audio = await ctx.db.select({ id: audioTracks.id }).from(audioTracks).where(eq(audioTracks.submissionId, ctx.sub.id)).get();
  const receipt = await ctx.db.get<{ ready: number }>(sql`SELECT 1 AS ready FROM submission_analysis WHERE submission_id=${ctx.sub.id} AND audio_state='none' AND frames_complete=1`);
  if (audio || receipt || now() - (ctx.sub.uploadedAt ?? 0) >= WAIT_FOR_ANALYSIS_MS) return false;
  await ctx.env.PIPELINE.send({ type: "process_submission", payload }, { delaySeconds: REQUEUE_DELAY_S });
  return true;
}

async function queueStages(ctx: Ctx, stages: JobStage[], retry: readonly JobStage[]) {
  const generation = ctx.analysis!.generation;
  const requestId = ctx.analysis!.requestId;
  const firstRequest = sql`EXISTS(SELECT 1 FROM submission_analysis_retries r WHERE r.submission_id=${ctx.sub.id} AND r.request_id=${requestId}
    AND r.first_claim_token=${ctx.analysis!.token})`;
  const results = await analysisWrite(ctx, [sql`INSERT INTO submission_analysis_retries(submission_id,request_id,generation,seen_at,first_claim_token)
    SELECT ${ctx.sub.id},${requestId},${generation},${now()},${ctx.analysis!.token} WHERE ${requestId} IS NOT NULL ON CONFLICT DO NOTHING`, ...stages.map((stage) => ctx.db
      .insert(processingJobs)
      .values({ id: newId(), submissionId: ctx.sub.id, stage, status: "queued", analysisGeneration: generation, stageRequestId: requestId })
      .onConflictDoUpdate({ target: [processingJobs.submissionId, processingJobs.stage], set: { status: "queued", attempts: 0, startedAt: null, finishedAt: null, error: null, analysisGeneration: generation, stageRequestId: requestId },
        setWhere: sql`${processingJobs.analysisGeneration}<>${generation} OR ${processingJobs.status} IN ('queued','running') OR (${retry.includes(stage) ? 1 : 0}=1 AND ${firstRequest})` }).returning({ stage: processingJobs.stage })),
    ctx.db.update(submissions).set({ status: "processing" }).where(and(eq(submissions.id, ctx.sub.id), sql`EXISTS(SELECT 1 FROM processing_jobs
      WHERE submission_id=${ctx.sub.id} AND analysis_generation=${generation} AND status IN ('queued','running') AND stage IN(SELECT value FROM json_each(${JSON.stringify(stages)})))`))]);
  return stages.filter((_, index) => results[index + 2]!.results.length > 0);
}

export async function processSubmission(raw: unknown, env: Env) {
  const payload = payloadSchema.parse(raw);
  const db = getDb(env.DB);
  const ctx = await loadCtx(env, db, payload.submissionId);
  if (!ctx) return;
  if (!(await mediaWritable(db, ctx.sub.id))) return cancelJobs(db, [ctx.sub.id]);
  if (await requeueIfEarly(ctx, payload)) return;

  try {
    const requestId = payload.stages ? payload.requestId ?? `legacy:${payload.stages.join(",")}` : null;
    const claim = await claimAnalysis(ctx, requestId);
    if (claim === "done") return;
    if (claim === "busy") { await env.PIPELINE.send({ type: "process_submission", payload }, { delaySeconds: REQUEUE_DELAY_S }); return; }
    // A detect retry must not stamp old transcripts as terminal for a new audio
    // generation before that generation's transcription has run.
    const requested = payload.stages;
    const stages: JobStage[] = requested && ctx.analysis!.pendingGeneration && requested.some((stage) => stage === "detect" || stage === "translate")
      ? [...new Set<JobStage>(["transcribe", "translate", ...requested])] : requested ?? [...JOB_STAGES];
    const pending = await queueStages(ctx, stages, payload.stages ?? []);
    for (const stage of pending) { await renewAnalysis(ctx); await runStage(ctx, stage); }
    await finishAnalysis(ctx, pending.length > 0);
  } catch (error) {
    if (error instanceof StaleAnalysis) return; // Never cancel a newer generation's jobs.
    if (!(await mediaWritable(db, ctx.sub.id))) return cancelJobs(db, [ctx.sub.id]);
    await releaseAnalysis(ctx).catch(() => { console.error("[pipeline_claim_release_failed]"); });
    throw error;
  }
}

async function runStage(ctx: Ctx, stage: JobStage) {
  const { db, sub } = ctx;
  const where = jobWhere(sub.id, stage);
  const startedAt = now();
  await analysisWrite(ctx, [db.update(processingJobs).set({ status: "running", startedAt }).where(where)]);
  try {
    const note = await STAGE_FNS[stage](ctx);
    await analysisWrite(ctx, [db.update(processingJobs).set({ status: "done", finishedAt: now(), error: note }).where(where),
      processingEvent(ctx, "processing_job_completed", { stage, duration_ms: now() - startedAt })]);
  } catch (e) {
    if (e instanceof StaleAnalysis) throw e;
    const skipped = e instanceof StageSkip;
    const reason = e instanceof Error ? e.message.slice(0, ERROR_MAX_CHARS) : "unknown";
    await analysisWrite(ctx, [db.update(processingJobs).set({ status: skipped ? "skipped" : "failed", finishedAt: now(), error: reason }).where(where),
      ...(!skipped ? [processingEvent(ctx, "processing_job_failed", { stage, reason })] : [])]);
    if (!skipped) console.error("[pipeline]", stage, sub.id, e);
  }
}

// 동의 철회 시 대기·진행 중인 작업을 멈춘다 (F-60 예외)
export async function cancelJobs(db: Db, submissionIds: string[]) {
  if (submissionIds.length === 0) return;
  await db
    .update(processingJobs)
    .set({ status: "skipped", error: "withdrawn", finishedAt: now() })
    .where(and(inArray(processingJobs.submissionId, submissionIds), inArray(processingJobs.status, ["queued", "running"])));
}

export async function cancelProcessingFor(db: Db, giId: string, consentId?: string) {
  const subs = await db.select({ id: submissions.id }).from(submissions).where(and(eq(submissions.guideInfluencerId, giId), consentId ? sql`EXISTS (SELECT 1 FROM media_purges p WHERE p.submission_id=${submissions.id} AND p.consent_id=${consentId})` : undefined));
  await cancelJobs(
    db,
    subs.map((s) => s.id),
  );
}
