import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, ne } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { guideInfluencers, submissions, uploadParts } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { UPLOAD_LIMITS, checkUpload } from "../../../shared/guides";
import { checkDriveAccess } from "../../lib/drive-access";
import { currentConsent, findSubmission, influencerTabs, markAborted, nextVersion, partsOf, requireByToken, uploadCtx } from "./shared";
import { versionHistory } from "./versions";

// 업로드 (F-59). 멀티파트로 올리고, 3분·2GB 초과는 드라이브 링크

const MAX_PART_NUMBER = 10_000;
const MB = 1024 ** 2;
const initBody = z.object({
  kind: z.enum(["final", "clean"]),
  fileName: z.string().trim().min(1).max(200),
  size: z.number().int().positive(),
  durationS: z.number().nonnegative(),
  width: z.number().int().nonnegative().nullable().default(null),
  height: z.number().int().nonnegative().nullable().default(null),
  note: z.string().max(500).default(""),
});
type InitBody = z.infer<typeof initBody>;
const externalBody = z.object({ kind: z.enum(["final", "clean"]), driveUrl: z.url({ protocol: /^https$/, error: "https 로 시작하는 링크를 넣어 주세요." }), note: z.string().max(500).default("") });
const submissionRef = z.object({ submissionId: z.string() });
const driveCheckBody = z.object({ url: z.string().trim().max(2000) });

const UPLOAD_REASONS = {
  too_large: "파일이 2GB를 넘어요. 드라이브 링크로 제출해 주세요.",
  too_long: "영상이 3분을 넘어요. 드라이브 링크로 제출해 주세요.",
  bad_format: "mp4, mov, webm 파일만 올릴 수 있어요.",
} as const;

// 승인 뒤 새 버전이 올라와도 기존 승인 단계는 그대로 둔다 (340)
const stillOpen = (giId: string) => and(eq(guideInfluencers.id, giId), ne(guideInfluencers.stage, "approved"));
const notUploading =() => new ApiError(409, "not_uploading", "이미 끝났거나 취소된 업로드예요.");

// 이어 올리기: 같은 종류·파일명·크기의 미완료 업로드
function resumableUpload(db: Db, giId: string, body: InitBody) {
  return db
    .select()
    .from(submissions)
    .where(and(eq(submissions.guideInfluencerId, giId), eq(submissions.status, "uploading"), eq(submissions.kind, body.kind), eq(submissions.fileName, body.fileName), eq(submissions.sizeBytes, body.size)))
    .orderBy(desc(submissions.createdAt))
    .get();
}

async function startUpload(env: Env, db: Db, ids: { guideId: string; giId: string }, body: InitBody) {
  const id = newId();
  const ext = body.fileName.split(".").pop()!.toLowerCase();
  const key = `originals/${ids.guideId}/${ids.giId}/${id}.${ext}`;
  const mpu = await env.FILES.createMultipartUpload(key, { httpMetadata: { contentType: ext === "mov" ? "video/quicktime" : `video/${ext}` } });
  await db.insert(submissions).values({
    id,
    guideInfluencerId: ids.giId,
    version: await nextVersion(db, ids.giId, body.kind),
    kind: body.kind,
    fileName: body.fileName,
    sizeBytes: body.size,
    originalKey: key,
    durationS: body.durationS,
    sizeMb: Math.round((body.size / MB) * 10) / 10,
    width: body.width,
    height: body.height,
    status: "uploading",
    note: body.note || null,
    uploadId: mpu.uploadId,
    createdAt: now(),
  });
  return id;
}

export const uploadRoutes = new Hono<AppEnv>()
  .get("/upload/:token", async (c) => {
    const db = c.var.db;
    const { gi, guide, influencer, brandName } = await requireByToken(db, "uploadToken", c.req.param("token"));
    const consent = await currentConsent(db, gi.id);
    const { groups, approval } = await versionHistory(db, gi.id);
    return c.json({
      brandName,
      guideName: guide.name,
      lang: influencer.lang,
      displayName: influencer.displayName,
      consented: !!consent,
      tabs: await influencerTabs(db, gi, guide),
      approved: !!approval,
      deliverables: guide.deliverables,
      limits: UPLOAD_LIMITS,
      // 버전별 한 줄, 최신순 (TASK-074)
      versions: groups,
    });
  })
  .post("/upload/:token/init", async (c) => {
    const body = parse(initBody, await c.req.json());
    const db = c.var.db;
    const { gi, guide } = await uploadCtx(c);
    const check = checkUpload(body.fileName, body.size, body.durationS);
    if (!check.ok) throw new ApiError(400, check.reason, UPLOAD_REASONS[check.reason]);
    const resumable = await resumableUpload(db, gi.id, body);
    if (resumable) {
      await logEvent(db, guide.workspaceId, "upload_resumed", { submission_id: resumable.id });
      return c.json({ submissionId: resumable.id, partSize: UPLOAD_LIMITS.partBytes, doneParts: (await partsOf(db, resumable.id)).map((p) => p.partNumber) });
    }
    const id = await startUpload(c.env, db, { guideId: guide.id, giId: gi.id }, body);
    await logEvent(db, guide.workspaceId, "upload_started", { size_mb: Math.round(body.size / MB), duration_s: Math.round(body.durationS) });
    return c.json({ submissionId: id, partSize: UPLOAD_LIMITS.partBytes, doneParts: [] }, 201);
  })
  .put("/upload/:token/part", async (c) => {
    const db = c.var.db;
    const { gi } = await uploadCtx(c);
    const n = Number(c.req.query("n"));
    if (!Number.isInteger(n) || n < 1 || n > MAX_PART_NUMBER) throw new ApiError(400, "bad_part", "part 번호가 올바르지 않아요.");
    const s = await findSubmission(db, gi, c.req.query("submissionId") ?? "");
    if (s.status !== "uploading" || !s.originalKey || !s.uploadId) throw notUploading();
    const data = await c.req.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > UPLOAD_LIMITS.partBytes) throw new ApiError(400, "bad_part_size", "part 크기가 올바르지 않아요.");
    const part = await c.env.FILES.resumeMultipartUpload(s.originalKey, s.uploadId).uploadPart(n, data);
    await db
      .insert(uploadParts)
      .values({ submissionId: s.id, partNumber: n, etag: part.etag, size: data.byteLength })
      .onConflictDoUpdate({ target: [uploadParts.submissionId, uploadParts.partNumber], set: { etag: part.etag, size: data.byteLength } });
    return c.json({ partNumber: n, etag: part.etag });
  })
  .get("/upload/:token/status", async (c) => {
    const db = c.var.db;
    const { gi } = await uploadCtx(c);
    const s = await findSubmission(db, gi, c.req.query("submissionId") ?? "");
    return c.json({ status: s.status, doneParts: (await partsOf(db, s.id)).map((p) => p.partNumber) });
  })
  .post("/upload/:token/complete", async (c) => {
    const { submissionId } = parse(submissionRef, await c.req.json());
    const db = c.var.db;
    const { gi, guide } = await uploadCtx(c);
    const s = await findSubmission(db, gi, submissionId);
    if (s.status !== "uploading" || !s.originalKey || !s.uploadId) throw notUploading();
    // 클라이언트가 보낸 목록 대신 서버가 기록한 part 로 완료한다
    const parts = await partsOf(db, s.id);
    if (parts.reduce((a, p) => a + p.size, 0) !== s.sizeBytes) throw new ApiError(400, "incomplete", "아직 올라가지 않은 부분이 있어요. 다시 시도해 주세요.");
    await c.env.FILES.resumeMultipartUpload(s.originalKey, s.uploadId).complete(parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));
    const uploadedAt = now();
    // 버전은 완료 시점에 다시 정한다: 동시에 올린 완성본이 같은 번호를 받거나 클린본이 지난 완성본에 붙지 않게
    const version = await nextVersion(db, gi.id, s.kind);
    await db.batch([
      db.update(submissions).set({ status: "uploaded", uploadedAt, version }).where(eq(submissions.id, s.id)),
      db.delete(uploadParts).where(eq(uploadParts.submissionId, s.id)),
      db.update(guideInfluencers).set({ stage: "uploaded" }).where(stillOpen(gi.id)),
    ]);
    await logEvent(db, guide.workspaceId, "upload_completed", { submission_id: s.id, gi_id: gi.id, version, upload_s: Math.round((uploadedAt - s.createdAt) / 1000) });
    await c.env.PIPELINE.send({ type: "process_submission", payload: { submissionId: s.id } }).catch((e: unknown) => console.error("[queue:send]", e));
    return c.json({ ok: true, version });
  })
  .post("/upload/:token/abort", async (c) => {
    const { submissionId } = parse(submissionRef, await c.req.json());
    const db = c.var.db;
    const { gi } = await uploadCtx(c);
    const s = await findSubmission(db, gi, submissionId);
    if (s.status !== "uploading") return c.json({ ok: true });
    if (s.originalKey && s.uploadId) await c.env.FILES.resumeMultipartUpload(s.originalKey, s.uploadId).abort();
    await markAborted(db, s.id);
    return c.json({ ok: true });
  })
  // 입력 중 즉시 확인. 판정만 돌려주고 저장하지 않는다
  .post("/upload/:token/drive-check", async (c) => {
    const { url } = parse(driveCheckBody, await c.req.json());
    await uploadCtx(c);
    return c.json({ access: await checkDriveAccess(url) });
  })
  // 드라이브 링크 제출. 자동 처리 없음, 브랜드가 수동 확인. 막힌 링크도 받되 판정을 다시 해 남긴다
  .post("/upload/:token/external", async (c) => {
    const body = parse(externalBody, await c.req.json());
    const db = c.var.db;
    const { gi, guide } = await uploadCtx(c);
    const version = await nextVersion(db, gi.id, body.kind);
    const driveAccess = await checkDriveAccess(body.driveUrl);
    const submissionId = newId();
    await db.insert(submissions).values({ id: submissionId, guideInfluencerId: gi.id, version, kind: body.kind, status: "uploaded_external", driveUrl: body.driveUrl, driveAccess, note: body.note || null, createdAt: now(), uploadedAt: now() });
    await db.update(guideInfluencers).set({ stage: "uploaded" }).where(stillOpen(gi.id));
    await logEvent(db, guide.workspaceId, "upload_completed", { submission_id: submissionId, gi_id: gi.id, version, external: true });
    return c.json({ ok: true, version, driveAccess }, 201);
  });
