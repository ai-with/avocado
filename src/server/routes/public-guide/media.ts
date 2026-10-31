import { Hono } from "hono";
import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../../types";
import { audioTracks, frames } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { UPLOAD_LIMITS } from "../../../shared/guides";
import { findSubmission, uploadCtx } from "./shared";
import { assertMediaWritable, withMediaWrite } from "../../lib/media-purge";
import { analysisSqlBatch, audioHash, writableSql } from "../../pipeline/analysis";
import { AUDIO_UNAVAILABLE_REASONS, NO_AUDIO_PROOF } from "../../../shared/audio-analysis";

// 업로드 완료 뒤 브라우저가 뽑아 보내는 분석 재료 (프레임, 오디오)

const MB = 1024 ** 2;
const MAX_FRAME_BYTES = 2 * MB;
const MAX_AUDIO_BYTES = 30 * MB;
const receiptBody = z.object({ submissionId: z.string().min(1).max(100), frameCount: z.number().int().min(1).max(UPLOAD_LIMITS.maxFrames),
  outcome: z.discriminatedUnion("kind", [z.object({ kind: z.literal("no_audio"), proof: z.literal(NO_AUDIO_PROOF) }).strict(),
    z.object({ kind: z.literal("unavailable"), reason: z.enum(AUDIO_UNAVAILABLE_REASONS) }).strict()]) }).strict();
async function wake(env: Env, submissionId: string) {
  try { await env.PIPELINE.send({ type: "process_submission", payload: { submissionId } }); }
  catch { throw new ApiError(503, "analysis_queue_unavailable", "분석 요청을 확인하지 못했어요. 다시 시도해 주세요."); }
}

export const mediaRoutes = new Hono<AppEnv>()
  // This receipt is sent only after all extracted frames have been uploaded.
  .post("/upload/:token/analysis-complete", async (c) => {
    const body = parse(receiptBody, await c.req.json()), db = c.var.db;
    const { gi } = await uploadCtx(c), s = await findSubmission(db, gi, body.submissionId);
    if (!s.originalKey || !["uploaded", "processing", "ready", "failed"].includes(s.status)) throw new ApiError(409, "analysis_not_ready", "영상 업로드를 먼저 완료해 주세요.");
    const reason = body.outcome.kind === "no_audio" ? NO_AUDIO_PROOF : body.outcome.reason;
    let changed: { audio_state: string }[];
    try { const result = await analysisSqlBatch(c.env.DB, [sql`UPDATE submission_analysis SET
      audio_state=CASE WHEN ${body.outcome.kind}='no_audio' THEN 'none' ELSE audio_state END,audio_reason=${reason},frames_complete=1,
      generation=generation+CASE WHEN ${body.outcome.kind}='no_audio' THEN 1 ELSE 0 END,
      claim_token=CASE WHEN ${body.outcome.kind}='no_audio' THEN NULL ELSE claim_token END,
      claim_until=CASE WHEN ${body.outcome.kind}='no_audio' THEN NULL ELSE claim_until END
      WHERE submission_id=${s.id} AND audio_state='unknown' AND ${writableSql(s.id)}
      AND NOT EXISTS(SELECT 1 FROM audio_tracks WHERE submission_id=${s.id})
      AND (SELECT count(*) FROM frames WHERE submission_id=${s.id})=${body.frameCount}
      RETURNING audio_state`, ...(["transcribe", "translate"] as const).map((stage) => sql`
      INSERT INTO processing_jobs(id,submission_id,stage,status,finished_at,error,analysis_generation)
      SELECT ${newId()},a.submission_id,${stage},'skipped',${now()},${stage === "transcribe" ? "no_audio_track" : "no_transcript"},a.generation
      FROM submission_analysis a WHERE a.submission_id=${s.id} AND a.audio_state='none' AND a.frames_complete=1 AND ${writableSql(s.id)}
      ON CONFLICT(submission_id,stage) DO UPDATE SET status='skipped',attempts=0,finished_at=excluded.finished_at,error=excluded.error,analysis_generation=excluded.analysis_generation
      WHERE processing_jobs.analysis_generation<>excluded.analysis_generation OR processing_jobs.status IN ('queued','running')`)]);
      changed = result[0]!.results as { audio_state: string }[];
    }
    catch {
      await assertMediaWritable(db, s.id);
      throw new ApiError(503, "analysis_receipt_unavailable", "분석 결과를 저장하지 못했어요. 다시 시도해 주세요.");
    }
    await assertMediaWritable(db, s.id);
    const receipt = await db.query.submissionAnalysis.findFirst({ where: (a, { eq }) => eq(a.submissionId, s.id) });
    if (!changed.length && receipt?.audioState === "unknown") throw new ApiError(409, "analysis_not_ready", "프레임 전송을 먼저 완료해 주세요.");
    // Duplicate receipts reattempt only the wake; they never rotate generations.
    if (receipt?.audioState === "none") await wake(c.env, s.id);
    return c.json({ ok: true });
  })
  // jpeg 프레임. 영상당 180장 상한
  .post("/upload/:token/frames", async (c) => {
    const db = c.var.db;
    const { gi } = await uploadCtx(c);
    const form = await c.req.formData();
    const s = await findSubmission(db, gi, String(form.get("submissionId") ?? ""));
    const tMs = Number(form.get("t_ms"));
    const source = form.get("source") === "scene" ? "scene" : "fps";
    const image = form.get("image");
    if (!Number.isInteger(tMs) || tMs < 0 || !(image instanceof File) || image.type !== "image/jpeg" || image.size > MAX_FRAME_BYTES)
      throw new ApiError(400, "bad_frame", "프레임 형식이 올바르지 않아요.");
    const n = await db.select({ n: count() }).from(frames).where(eq(frames.submissionId, s.id)).get();
    if ((n?.n ?? 0) >= UPLOAD_LIMITS.maxFrames) throw new ApiError(400, "too_many_frames", "프레임은 영상당 180장까지예요.");
    const key = `frames/${s.id}/${tMs}.jpg`;
    await withMediaWrite(c.env, db, s.id, { key, kind: "object" },
      async () => c.env.FILES.put(key, await image.arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } }),
      async () => { await db.insert(frames).values({ id: newId(), submissionId: s.id, tMs, imageKey: key, source }).onConflictDoNothing(); });
    return c.json({ ok: true }, 201);
  })
  // 16kHz mono WAV
  .post("/upload/:token/audio", async (c) => {
    const db = c.var.db;
    const { gi } = await uploadCtx(c);
    const form = await c.req.formData();
    const s = await findSubmission(db, gi, String(form.get("submissionId") ?? ""));
    const audio = form.get("audio");
    const sampleRate = Number(form.get("sampleRate"));
    const durationS = Number(form.get("durationS"));
    if (!(audio instanceof File) || audio.size > MAX_AUDIO_BYTES || !Number.isFinite(durationS)) throw new ApiError(400, "bad_audio", "오디오 형식이 올바르지 않아요.");
    const bytes = await audio.arrayBuffer(), contentHash = await audioHash(bytes);
    const key = `audio/${s.id}.wav`;
    await withMediaWrite(c.env, db, s.id, { key, kind: "object" },
      async () => c.env.FILES.put(key, bytes, { httpMetadata: { contentType: "audio/wav" } }),
      async () => { await db.insert(audioTracks).values({ id: newId(), submissionId: s.id, key, sampleRate, durationS, contentHash })
        .onConflictDoUpdate({ target: audioTracks.submissionId, set: { key, sampleRate, durationS, contentHash } }); });
    await wake(c.env, s.id);
    return c.json({ ok: true }, 201);
  });
