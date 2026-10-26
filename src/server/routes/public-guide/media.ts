import { Hono } from "hono";
import { count, eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { audioTracks, frames } from "../../db/schema";
import { ApiError } from "../../lib/errors";
import { newId } from "../../lib/ids";
import { UPLOAD_LIMITS } from "../../../shared/guides";
import { findSubmission, uploadCtx } from "./shared";

// 업로드 완료 뒤 브라우저가 뽑아 보내는 분석 재료 (프레임, 오디오)

const MB = 1024 ** 2;
const MAX_FRAME_BYTES = 2 * MB;
const MAX_AUDIO_BYTES = 30 * MB;

export const mediaRoutes = new Hono<AppEnv>()
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
    await c.env.FILES.put(key, await image.arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } });
    await db.insert(frames).values({ id: newId(), submissionId: s.id, tMs, imageKey: key, source }).onConflictDoNothing();
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
    const key = `audio/${s.id}.wav`;
    await c.env.FILES.put(key, await audio.arrayBuffer(), { httpMetadata: { contentType: "audio/wav" } });
    await db
      .insert(audioTracks)
      .values({ id: newId(), submissionId: s.id, key, sampleRate, durationS })
      .onConflictDoUpdate({ target: audioTracks.submissionId, set: { key, sampleRate, durationS } });
    return c.json({ ok: true }, 201);
  });
