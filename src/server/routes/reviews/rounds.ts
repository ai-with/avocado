import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq, isNull, min, ne } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { approvals, feedbackItems, guideInfluencers, reviewRounds, submissions, supersededVersions } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { sendEmail } from "../../lib/email";
import { guideLinks } from "../../lib/guides";
import { brandNameOf } from "../../lib/brands";
import { approvedMail, feedbackRoundMail } from "../../lib/influencer-mails";
import { approversOnly, editorsOnly } from "../../middleware/auth";
import { BRAND_LANG, approvedRefOf, assertUnlocked, influencerEmail, isSuperseded, lastRoundN, loadSub } from "./shared";
import { approveCheck } from "./policy";

// 피드백 보내기(라운드)와 최종 승인

const HOUR_MS = 3_600_000;
const roundBody = z.object({ translations: z.record(z.string(), z.string().max(4000)).default({}), sendOriginal: z.boolean().default(false) });
type Draft = typeof feedbackItems.$inferSelect;
type Loaded = Awaited<ReturnType<typeof loadSub>>;
const APPROVE_ERRORS = {
  already_approved: "이미 최종 승인한 버전이에요.",
  older_than_approved: "승인된 버전보다 앞선 버전은 승인할 수 없어요.",
  closed: "기존 승인 유지로 닫은 버전이에요.",
} as const;

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
    // 승인 뒤 새 버전에 피드백을 보내도 기존 승인 단계는 그대로 둔다 (340)
    db.update(guideInfluencers).set({ stage: "feedback_sent" }).where(and(eq(guideInfluencers.id, s.gi.id), ne(guideInfluencers.stage, "approved"))),
  ]);
  return round;
}

async function hoursFromFirstUpload(db: Db, giId: string, at: number) {
  const first = await db.select({ t: min(submissions.uploadedAt) }).from(submissions).where(and(eq(submissions.guideInfluencerId, giId), ne(submissions.status, "aborted"))).get();
  return first?.t ? Math.round(((at - first.t) / HOUR_MS) * 10) / 10 : null;
}

// 메일 머리의 브랜드는 캠페인 브랜드 (TASK-070)
const recipient = async (env: Env, db: Db, s: Loaded) => ({ brand: await brandNameOf(db, s.workspace.id, s.guide.id), name: s.influencer.displayName, en: s.influencer.lang === "en", url: guideLinks(env, s.gi).feedback });

export const roundRoutes = new Hono<AppEnv>()
  // '피드백 보내기' = 라운드 +1. 브랜드가 확인한 번역문으로 보낸다 (4-2)
  .post("/:id/rounds", editorsOnly, async (c) => {
    const body = parse(roundBody, await c.req.json());
    const db = c.var.db;
    const s = await loadSub(c, c.req.param("id"));
    await assertUnlocked(db, s.sub);
    const drafts = await db.select().from(feedbackItems).where(and(eq(feedbackItems.submissionId, s.sub.id), isNull(feedbackItems.roundId))).orderBy(asc(feedbackItems.tMs), asc(feedbackItems.createdAt));
    if (drafts.length === 0) throw new ApiError(400, "no_feedback", "보낼 코멘트가 없어요.");
    const textOf = s.influencer.lang !== BRAND_LANG ? translationFor(drafts, body.translations, body.sendOriginal) : () => null;
    const round = await saveRound(db, s, drafts, textOf);
    await logEvent(db, s.workspace.id, "review_round_submitted", { gi_id: s.gi.id, round: round.n, comment_count: drafts.length });

    const to = await influencerEmail(db, s.gi.id, s.influencer);
    const email = to ? await sendEmail(c.env, { to, ...feedbackRoundMail(await recipient(c.env, db, s), s.guide.name, drafts.length) }) : { delivered: false };
    return c.json({ ok: true, round: round.n, email });
  })
  // 최종 승인 (owner, approver). 승인 뒤 새 버전을 승인하면 승인이 그 버전으로 옮겨가고 승인 메일을 다시 보낸다 (340)
  .post("/:id/approve", approversOnly, async (c) => {
    const db = c.var.db;
    const s = await loadSub(c, c.req.param("id"));
    const { sub, gi } = s;
    if (sub.kind !== "final") throw new ApiError(400, "not_final", "완성본만 승인할 수 있어요.");
    const approved = await approvedRefOf(db, gi.id);
    const check = approveCheck(sub, approved, await isSuperseded(db, sub.id));
    if (check !== "first" && check !== "move") throw new ApiError(409, check, APPROVE_ERRORS[check]);
    const at = now();
    const row = { submissionId: sub.id, approvedBy: s.user.id, approvedAt: at };
    await db.batch([
      check === "first" ? db.insert(approvals).values({ id: newId(), guideInfluencerId: gi.id, ...row }) : db.update(approvals).set(row).where(eq(approvals.guideInfluencerId, gi.id)),
      db.update(guideInfluencers).set({ stage: "approved" }).where(eq(guideInfluencers.id, gi.id)),
    ]);
    await logEvent(db, s.workspace.id, "final_approved", { gi_id: gi.id, rounds_used: await lastRoundN(db, gi.id), hours_from_first_upload: await hoursFromFirstUpload(db, gi.id, at), moved_from_version: approved?.version ?? null });
    const to = await influencerEmail(db, gi.id, s.influencer);
    if (to) c.executionCtx.waitUntil(sendEmail(c.env, { to, ...approvedMail(await recipient(c.env, db, s), s.guide.name) }).then(() => undefined));
    return c.json({ ok: true });
  })
  // 승인 뒤 새 버전을 '기존 승인 유지'로 닫는다. 인플루언서에게 알리지 않는다 (340)
  .post("/:id/keep-approval", approversOnly, async (c) => {
    const db = c.var.db;
    const { sub, gi, workspace, user } = await loadSub(c, c.req.param("id"));
    const approved = await approvedRefOf(db, gi.id);
    if (approveCheck(sub, approved, await isSuperseded(db, sub.id)) !== "move") throw new ApiError(409, "not_after_approval", "승인 뒤 올라온 새 버전만 기존 승인 유지로 닫을 수 있어요.");
    await db.insert(supersededVersions).values({ submissionId: sub.id, guideInfluencerId: gi.id, keptBy: user.id, keptAt: now() });
    await logEvent(db, workspace.id, "approval_kept", { version: sub.version, approved_version: approved?.version ?? null });
    return c.json({ ok: true });
  });
