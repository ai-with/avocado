import { Hono } from "hono";
import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../../types";
import { frames } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { UPLOAD_LIMITS } from "../../../shared/guides";
import { findSubmission, uploadCtx } from "./shared";
import { assertMediaWritable, withMediaWrite } from "../../lib/media-purge";
import { analysisSqlBatch, writableSql } from "../../pipeline/analysis";
import { storeAudio } from "../../lib/audio-write";
import { AUDIO_UNAVAILABLE_REASONS, NO_AUDIO_PROOF } from "../../../shared/audio-analysis";
import { completePreparedFrames } from "../../lib/media-preparation";

// 업로드 완료 뒤 브라우저가 뽑아 보내는 분석 재료 (프레임, 오디오)

const MB = 1024 ** 2;
const MAX_FRAME_BYTES = 2 * MB;
const MAX_AUDIO_BYTES = 30 * MB;
const receiptBody = z.object({ submissionId: z.string().min(1).max(100), frameCount: z.number().int().min(1).max(UPLOAD_LIMITS.maxFrames),
  outcome: z.discriminatedUnion("kind", [z.object({ kind: z.literal("no_audio"), proof: z.literal(NO_AUDIO_PROOF) }).strict(),
    z.object({ kind: z.literal("unavailable"), reason: z.enum(AUDIO_UNAVAILABLE_REASONS) }).strict()]) }).strict();
const MAX_RECEIPT_BYTES = 8 * 1024;
const receiptCache = new WeakMap<Request, Promise<z.infer<typeof receiptBody>>>();
const largeReceipt = () => new ApiError(413, "request_too_large", "분석 결과가 너무 커요. 다시 시도해 주세요.");
const invalidReceipt = () => new ApiError(400, "invalid_json", "분석 결과 형식을 확인해 주세요.");
export const isPublicAnalysisCompleteRequest = (method: string, path: string) => method === "POST" && /^\/api\/public\/upload\/[^/]+\/analysis-complete$/.test(path);
async function parseReceipt(request: Request) {
  const declared = request.headers.get("Content-Length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_RECEIPT_BYTES) {
    void request.body?.cancel().catch(() => {}); throw largeReceipt();
  }
  const reader = request.body?.getReader();
  if (!reader) throw invalidReceipt();
  let size = 0;
  const bytes = new Uint8Array(MAX_RECEIPT_BYTES);
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      if (value.byteLength > MAX_RECEIPT_BYTES - size) { void reader.cancel().catch(() => {}); throw largeReceipt(); }
      bytes.set(value, size); size += value.byteLength;
    }
    return parse(receiptBody, JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, size))));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    void reader.cancel().catch(() => {}); throw invalidReceipt();
  } finally { reader.releaseLock(); }
}
// Preflight precedes even optional session IO; the handler reuses that exact
// request's validated input and still performs its existing token/consent checks.
export function readAnalysisReceipt(request: Request) {
  let pending = receiptCache.get(request);
  if (!pending) { pending = parseReceipt(request); receiptCache.set(request, pending); }
  return pending;
}
async function wake(env: Env, submissionId: string, prepared?: { retryDetect: boolean; generation: number } | null) {
  try { await env.PIPELINE.send({ type: "process_submission", payload: { submissionId,
    ...(prepared?.retryDetect ? { stages: ["detect"], requestId: `prepared-frames:${prepared.generation}` } : {}) } }); }
  catch { throw new ApiError(503, "analysis_queue_unavailable", "분석 요청을 확인하지 못했어요. 다시 시도해 주세요."); }
}

export const mediaRoutes = new Hono<AppEnv>()
  // This receipt is sent only after all extracted frames have been uploaded.
  .post("/upload/:token/analysis-complete", async (c) => {
    const body = await readAnalysisReceipt(c.req.raw), db = c.var.db;
    const { gi } = await uploadCtx(c), s = await findSubmission(db, gi, body.submissionId);
    if (!s.originalKey || !["uploaded", "processing", "ready", "failed"].includes(s.status)) throw new ApiError(409, "analysis_not_ready", "영상 업로드를 먼저 완료해 주세요.");
    if (c.env.MEDIA_PREPARATION) {
      const prepared = await completePreparedFrames(c.env, db, s.id, body.frameCount);
      if (prepared) { await wake(c.env, s.id, prepared); return c.json({ ok: true }); }
    }
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
    const frameCount = c.env.MEDIA_PREPARATION && form.has("frameCount") ? Number(form.get("frameCount")) : null;
    if (frameCount !== null && (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > UPLOAD_LIMITS.maxFrames)) throw new ApiError(400, "bad_frames", "프레임 전송 상태를 확인해 주세요.");
    if (!(audio instanceof File) || audio.size > MAX_AUDIO_BYTES || !Number.isFinite(durationS)) throw new ApiError(400, "bad_audio", "오디오 형식이 올바르지 않아요.");
    if (c.env.MEDIA_PREPARATION) {
      const prepared = await completePreparedFrames(c.env, db, s.id, frameCount, !form.has("frameHandshakeVersion"));
      if (prepared) { await wake(c.env, s.id, prepared); return c.json({ ok: true }, 201); }
    }
    await storeAudio(c.env, db, s.id, await audio.arrayBuffer(), sampleRate, durationS);
    if (c.env.MEDIA_PREPARATION && (frameCount !== null || !form.has("frameHandshakeVersion"))) await db.run(sql`UPDATE submission_analysis SET frames_complete=1 WHERE submission_id=${s.id}
      AND (SELECT count(*) FROM frames WHERE submission_id=${s.id}) ${frameCount === null ? sql`>0` : sql`=${frameCount}`} AND ${writableSql(s.id)}`);
    await wake(c.env, s.id);
    return c.json({ ok: true }, 201);
  });
