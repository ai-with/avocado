import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { audioTracks, frames, guideInfluencers, submissions } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { streamObject } from "../../lib/http";
import { registerContent } from "../../lib/contents";
import { findGuide, findGuideInfluencer } from "../../lib/guides";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { postUrlBody } from "./shared";
import { assertMediaWritable } from "../../lib/media-purge";

// 키 모양: originals/{guideId}/..., frames/{submissionId}/...,
// audio/{submissionId}/{hash}/{writeId}.wav (legacy audio/{submissionId}.wav도 지원)
async function guideIdOfKey(db: Db, key: string) {
  const kind = key.split("/", 1)[0];
  let subId: string | undefined;
  if (kind === "originals") subId = (await db.select({ id: submissions.id }).from(submissions).where(eq(submissions.originalKey, key)).get())?.id;
  if (kind === "frames") subId = (await db.select({ id: frames.submissionId }).from(frames).where(eq(frames.imageKey, key)).get())?.id;
  if (kind === "audio") subId = (await db.select({ id: audioTracks.submissionId }).from(audioTracks).where(eq(audioTracks.key, key)).get())?.id;
  if (!subId) return null;
  const row = await db
    .select({ guideId: guideInfluencers.guideId })
    .from(submissions)
    .innerJoin(guideInfluencers, eq(guideInfluencers.id, submissions.guideInfluencerId))
    .where(eq(submissions.id, subId))
    .get();
  return row ? { guideId: row.guideId, submissionId: subId } : null;
}

// 파일 (멤버 전용, Range 지원)
export const fileRoutes = new Hono<AppEnv>().get("/:key{.+}", async (c) => {
  const { workspace } = workspaceCtx(c);
  const db = c.var.db;
  const key = c.req.param("key");
  const owner = await guideIdOfKey(db, key);
  if (!owner) throw new ApiError(404, "file_not_found", "파일을 찾을 수 없어요.");
  await findGuide(db, workspace.id, owner.guideId);
  await assertMediaWritable(db, owner.submissionId);
  return streamObject(c.env.FILES, key, c.req.raw.headers, c.req.query("download") === "1");
});

// 게시물 URL: 브랜드가 가이드 상세 인플루언서 행에서 넣는다 (F-48)
export const guideContentRoutes = new Hono<AppEnv>().post("/:id/influencers/:giId/post-url", editorsOnly, async (c) => {
  const body = parse(postUrlBody, await c.req.json());
  const { workspace } = workspaceCtx(c);
  const db = c.var.db;
  const g = await findGuide(db, workspace.id, c.req.param("id"));
  const gi = await findGuideInfluencer(db, g.id, c.req.param("giId"));
  const r = await registerContent(c.env, db, { workspaceId: workspace.id, guideId: g.id, influencerId: gi.influencerId, guideInfluencerId: gi.id, url: body.url, by: "brand", replace: body.replace });
  return c.json(r);
});
