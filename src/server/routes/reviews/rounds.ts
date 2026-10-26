import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq, isNull, min, ne } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { approvals, feedbackItems, guideInfluencers, reviewRounds, submissions } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { sendEmail } from "../../lib/email";
import { guideLinks } from "../../lib/guides";
import { approvedMail, feedbackRoundMail } from "../../lib/influencer-mails";
import { approversOnly, editorsOnly } from "../../middleware/auth";
import { BRAND_LANG, approvalOf, assertUnlocked, influencerEmail, lastRoundN, loadSub } from "./shared";

// 피드백 보내기(라운드)와 최종 승인

const HOUR_MS = 3_600_000;
const roundBody = z.object({ translations: z.record(z.string(), z.string().max(4000)).default({}), sendOriginal: z.boolean().default(false) });
type Draft = typeof feedbackItems.$inferSelect;
type Loaded = Awaited<ReturnType<typeof loadSub>>;

// 브랜드가 확인한 번역문 > 저장된 번역문. 번역 실패 → 원문 전송 여부는 브랜드가 고른다 (F-60 9단계)
function translationFor(drafts: Draft[], translations: Record<string, string>, sendOriginal: boolean) {
  const pick = (d: Draft) => translations[d.id]?.trim() || d.textTranslated;
  const missing = drafts.filter((d) => !pick(d));
  if (missing.length && !sendOriginal) throw new ApiError(409, "translation_missing", `번역이 없는 코멘트가 ${missing.length}건 있어요. 원문으로 보낼지 골라 주세요.`);
  return (d: Draft) => pick(d) || null;
}

async function saveRound(db: Db, s: Loaded, drafts: Draft[], textOf: (d: Draft) => string | null) {
  const round = { id: newId(), submissionId: s.sub.id, guideInfluencerId: s.gi.id, n: (await lastRoundN(db, s.gi.id)) + 1, submittedAt: now(), submittedBy: s.user.id };
  await db.batch([
    db.insert(reviewRounds).values(round),
    ...drafts.map((d, i) => db.update(feedbackItems).set({ roundId: round.id, n: i + 1, textTranslated: textOf(d) }).where(eq(feedbackItems.id, d.id))),
    db.update(guideInfluencers).set({ stage: "feedback_sent" }).where(eq(guideInfluencers.id, s.gi.id)),
  ]);
  return round;
}

async function hoursFromFirstUpload(db: Db, giId: string, at: number) {
  const first = await db.select({ t: min(submissions.uploadedAt) }).from(submissions).where(and(eq(submissions.guideInfluencerId, giId), ne(submissions.status, "aborted"))).get();
  return first?.t ? Math.round(((at - first.t) / HOUR_MS) * 10) / 10 : null;
}

const recipient = (env: Env, s: Loaded) => ({ brand: s.workspace.name, name: s.influencer.displayName, en: s.influencer.lang === "en", url: guideLinks(env, s.gi).feedback });

export const roundRoutes = new Hono<AppEnv>()
  // '피드백 보내기' = 라운드 +1. 브랜드가 확인한 번역문으로 보낸다 (4-2)
  .post("/:id/rounds", editorsOnly, async (c) => {
    const body = parse(roundBody, await c.req.json());
    const db = c.var.db;
    const s = await loadSub(c, c.req.param("id"));
    await assertUnlocked(db, s.gi.id);
    const drafts = await db.select().from(feedbackItems).where(and(eq(feedbackItems.submissionId, s.sub.id), isNull(feedbackItems.roundId))).orderBy(asc(feedbackItems.tMs), asc(feedbackItems.createdAt));
    if (drafts.length === 0) throw new ApiError(400, "no_feedback", "보낼 코멘트가 없어요.");
    const textOf = s.influencer.lang !== BRAND_LANG ? translationFor(drafts, body.translations, body.sendOriginal) : () => null;
    const round = await saveRound(db, s, drafts, textOf);
    await logEvent(db, s.workspace.id, "review_round_submitted", { round: round.n, comment_count: drafts.length });

    const to = await influencerEmail(db, s.gi.id, s.influencer);
    const email = to ? await sendEmail(c.env, { to, ...feedbackRoundMail(recipient(c.env, s), s.guide.name, drafts.length) }) : { delivered: false };
    return c.json({ ok: true, round: round.n, email });
  })
  // 최종 승인 (owner, approver). 승인 후 코멘트 잠금, 인플루언서 페이지에 게시물 URL 입력란이 열린다
  .post("/:id/approve", approversOnly, async (c) => {
    const db = c.var.db;
    const s = await loadSub(c, c.req.param("id"));
    const { sub, gi } = s;
    if (sub.kind !== "final") throw new ApiError(400, "not_final", "완성본만 승인할 수 있어요.");
    if (await approvalOf(db, gi.id)) throw new ApiError(409, "already_approved", "이미 최종 승인했어요.");
    const at = now();
    await db.batch([
      db.insert(approvals).values({ id: newId(), guideInfluencerId: gi.id, submissionId: sub.id, approvedBy: s.user.id, approvedAt: at }),
      db.update(guideInfluencers).set({ stage: "approved" }).where(eq(guideInfluencers.id, gi.id)),
    ]);
    await logEvent(db, s.workspace.id, "final_approved", { rounds_used: await lastRoundN(db, gi.id), hours_from_first_upload: await hoursFromFirstUpload(db, gi.id, at) });
    const to = await influencerEmail(db, gi.id, s.influencer);
    if (to) c.executionCtx.waitUntil(sendEmail(c.env, { to, ...approvedMail(recipient(c.env, s), s.guide.name) }).then(() => undefined));
    return c.json({ ok: true });
  });
