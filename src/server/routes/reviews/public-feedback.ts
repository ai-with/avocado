import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { contents, feedbackItems, frames, guideInfluencers, reviewRounds, submissions } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { logEvent } from "../../lib/events";
import { translate } from "../../lib/ai";
import { streamObject } from "../../lib/http";
import { registerContent } from "../../lib/contents";
import { findByToken, guideLinks, linkNotFound } from "../../lib/guides";
import { fmtTimecode } from "../../../shared/review";
import { BRAND_LANG, approvalOf, postUrlBody } from "./shared";

// 인플루언서 피드백 페이지 (/f/:token). 로그인 없이 feedback_token 으로

type Gi = typeof guideInfluencers.$inferSelect;
type Item = typeof feedbackItems.$inferSelect;

async function byFeedbackToken(db: Db, token: string) {
  const row = await findByToken(db, "feedbackToken", token);
  if (!row) throw linkNotFound();
  return row;
}

// 보낸 라운드의 항목만 인플루언서가 볼 수 있다
async function sentItem(db: Db, gi: Gi, itemId: string) {
  const item = await db
    .select({ item: feedbackItems })
    .from(feedbackItems)
    .innerJoin(reviewRounds, eq(reviewRounds.id, feedbackItems.roundId))
    .where(and(eq(feedbackItems.id, itemId), eq(reviewRounds.guideInfluencerId, gi.id)))
    .get();
  if (!item) throw new ApiError(404, "item_not_found", "피드백 항목을 찾을 수 없어요.");
  return item.item;
}

const publicItem = (token: string) => (i: Item) => ({
  id: i.id,
  n: i.n,
  tMs: i.tMs,
  timecode: fmtTimecode(i.tMs),
  frameUrl: i.frameId ? `/api/public/feedback/${token}/frame/${i.frameId}` : null,
  shape: i.shape,
  text: i.text,
  textTranslated: i.textTranslated,
  done: i.influencerDone,
  reply: i.reply,
});

// 답글은 브랜드 언어로 자동 번역
async function replyPatch(env: Env, reply: string, lang: string) {
  if (!reply || lang === BRAND_LANG) return { reply: reply || null, replyTranslated: null };
  const replyTranslated = await translate(env, reply, lang, BRAND_LANG).catch((e: unknown) => {
    console.error("[feedback:reply-translate]", e);
    return null;
  });
  return { reply, replyTranslated };
}

export const publicFeedbackRoutes = new Hono<AppEnv>()
  .get("/feedback/:token", async (c) => {
    const db = c.var.db;
    const token = c.req.param("token");
    const { gi, guide, influencer, workspaceName } = await byFeedbackToken(db, token);
    const rounds = await db.select().from(reviewRounds).where(eq(reviewRounds.guideInfluencerId, gi.id)).orderBy(desc(reviewRounds.n));
    const items = rounds.length ? await db.select().from(feedbackItems).where(inArray(feedbackItems.roundId, rounds.map((r) => r.id))).orderBy(asc(feedbackItems.n)) : [];
    const versions = new Map((await db.select({ id: submissions.id, version: submissions.version }).from(submissions).where(eq(submissions.guideInfluencerId, gi.id))).map((s) => [s.id, s.version]));
    const approval = await approvalOf(db, gi.id);
    const content = await db.select({ url: contents.url }).from(contents).where(eq(contents.guideInfluencerId, gi.id)).get();
    await logEvent(db, guide.workspaceId, "influencer_feedback_viewed", { guide_id: guide.id });
    return c.json({
      brandName: workspaceName,
      guideName: guide.name,
      lang: influencer.lang,
      displayName: influencer.displayName,
      uploadUrl: guideLinks(c.env, gi).upload,
      approved: !!approval,
      approvedVersion: approval ? (versions.get(approval.submissionId) ?? null) : null,
      postUrl: content?.url ?? null,
      rounds: rounds.map((r) => ({ n: r.n, version: versions.get(r.submissionId) ?? null, submittedAt: r.submittedAt, items: items.filter((i) => i.roundId === r.id).map(publicItem(token)) })),
    });
  })
  .get("/feedback/:token/frame/:frameId", async (c) => {
    const db = c.var.db;
    const { gi } = await byFeedbackToken(db, c.req.param("token"));
    const f = await db
      .select({ key: frames.imageKey })
      .from(frames)
      .innerJoin(submissions, eq(submissions.id, frames.submissionId))
      .where(and(eq(frames.id, c.req.param("frameId")), eq(submissions.guideInfluencerId, gi.id)))
      .get();
    if (!f) throw new ApiError(404, "file_not_found", "이미지를 찾을 수 없어요.");
    return streamObject(c.env.FILES, f.key, new Headers(), false);
  })
  // 항목별 '반영함' 체크와 질문 답글
  .post("/feedback/:token/items/:itemId", async (c) => {
    const body = parse(z.object({ done: z.boolean().optional(), reply: z.string().trim().max(2000).optional() }), await c.req.json());
    const db = c.var.db;
    const { gi, influencer } = await byFeedbackToken(db, c.req.param("token"));
    const item = await sentItem(db, gi, c.req.param("itemId"));
    const patch: Partial<typeof feedbackItems.$inferInsert> = {};
    if (body.done !== undefined) patch.influencerDone = body.done;
    if (body.reply !== undefined) Object.assign(patch, await replyPatch(c.env, body.reply, influencer.lang));
    if (Object.keys(patch).length) await db.update(feedbackItems).set(patch).where(eq(feedbackItems.id, item.id));
    return c.json({ ok: true });
  })
  // 최종 승인 뒤 게시물 URL (F-48). 먼저 들어온 값을 쓰고 다르면 브랜드에 확인 요청
  .post("/feedback/:token/post-url", async (c) => {
    const body = parse(postUrlBody.omit({ replace: true }), await c.req.json());
    const db = c.var.db;
    const { gi, guide } = await byFeedbackToken(db, c.req.param("token"));
    if (!(await approvalOf(db, gi.id))) throw new ApiError(403, "not_approved", "최종 승인 뒤에 게시물 주소를 넣을 수 있어요.");
    const r = await registerContent(c.env, db, { workspaceId: guide.workspaceId, guideId: guide.id, influencerId: gi.influencerId, guideInfluencerId: gi.id, url: body.url, by: "influencer" });
    return c.json({ status: r.status });
  });
