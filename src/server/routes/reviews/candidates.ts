import { Hono } from "hono";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { feedbackItems, frames, transcriptSegments, violationCandidates } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent, logEvents } from "../../lib/events";
import { reviewRules } from "../../lib/guides";
import { editorsOnly } from "../../middleware/auth";
import { RULE_TYPE_LABELS, type RuleType } from "../../../shared/guides";
import { assertUnlocked, feedbackBody, loadSub } from "./shared";
import { assertMediaWritable } from "../../lib/media-purge";

// 자동 분석 다시 시도, 위반 후보 판정, 놓친 위반 추가

const decisionBody = z.object({
  decision: z.enum(["adopted", "rejected", "held"]),
  reason: z.enum(["compliant", "irrelevant", "ambiguous", "other"]).nullable().default(null),
  note: z.string().trim().max(300).nullable().default(null),
});
type Candidate = typeof violationCandidates.$inferSelect;

// 후보 근거로 쓸 프레임: 후보가 가진 첫 프레임, 없으면 근거 대사 시점에 가장 가까운 프레임
async function evidenceFrame(db: Db, submissionId: string, frameIds: string[], segmentIds: string[]) {
  if (frameIds[0]) {
    const f = await db.select().from(frames).where(eq(frames.id, frameIds[0])).get();
    if (f) return { frameId: f.id, tMs: f.tMs };
  }
  const seg = segmentIds[0] ? await db.select({ startMs: transcriptSegments.startMs }).from(transcriptSegments).where(eq(transcriptSegments.id, segmentIds[0])).get() : null;
  const t = seg?.startMs ?? 0;
  const all = await db.select({ id: frames.id, tMs: frames.tMs }).from(frames).where(eq(frames.submissionId, submissionId));
  const near = all.sort((a, b) => Math.abs(a.tMs - t) - Math.abs(b.tMs - t))[0];
  return { frameId: near?.id ?? null, tMs: near?.tMs ?? t };
}

// 채택한 후보로 보내기 전 피드백 초안을 만든다
async function draftFromCandidate(db: Db, submissionId: string, cand: Candidate, authorId: string) {
  const ev = await evidenceFrame(db, submissionId, cand.frameIds, cand.segmentIds);
  const label = RULE_TYPE_LABELS[cand.ruleType as RuleType] ?? cand.ruleType;
  await db.insert(feedbackItems).values({
    id: newId(),
    submissionId,
    frameId: ev.frameId,
    tMs: ev.tMs,
    shape: null,
    text: `[${label}] ${cand.ruleContent}. ${cand.reason} 이 부분을 수정해 주세요.`,
    source: "candidate",
    candidateId: cand.id,
    ruleId: cand.ruleId,
    authorId,
    createdAt: now(),
  });
}

export const candidateRoutes = new Hono<AppEnv>()
  // 전사 실패 시 '다시 요청' (F-60 5단계), 자동 분석 다시 시도
  .post("/:id/retry", editorsOnly, async (c) => {
    const { stage } = parse(z.object({ stage: z.enum(["transcribe", "detect"]) }), await c.req.json());
    const { sub } = await loadSub(c, c.req.param("id"));
    await assertMediaWritable(c.var.db, sub.id);
    if (!sub.originalKey) throw new ApiError(400, "no_file", "드라이브 링크 제출은 자동 처리하지 않아요.");
    const stages = stage === "transcribe" ? ["transcribe", "translate", "detect"] : ["detect"];
    await c.env.PIPELINE.send({ type: "process_submission", payload: { submissionId: sub.id, stages } });
    return c.json({ ok: true });
  })
  // 후보 판정: 채택이면 피드백 초안이 생기고, 채택을 풀면 보내지 않은 초안은 지운다
  .post("/:id/candidates/:cid", editorsOnly, async (c) => {
    const body = parse(decisionBody, await c.req.json());
    const rejected = body.decision === "rejected";
    if (rejected && !body.reason) throw new ApiError(400, "validation_error", "기각 사유를 골라 주세요.", { reason: "기각 사유를 골라 주세요." });
    const db = c.var.db;
    const { sub, gi, workspace, user } = await loadSub(c, c.req.param("id"));
    await assertUnlocked(db, sub);
    const cand = await db.select().from(violationCandidates).where(and(eq(violationCandidates.id, c.req.param("cid")), eq(violationCandidates.submissionId, sub.id))).get();
    if (!cand) throw new ApiError(404, "candidate_not_found", "위반 후보를 찾을 수 없어요.");
    await db
      .update(violationCandidates)
      .set({ decision: body.decision, decisionReason: rejected ? body.reason : null, decisionNote: rejected ? body.note || null : null, decidedBy: user.id, decidedAt: now() })
      .where(eq(violationCandidates.id, cand.id));
    const draft = await db.select({ id: feedbackItems.id }).from(feedbackItems).where(and(eq(feedbackItems.candidateId, cand.id), isNull(feedbackItems.roundId))).get();
    if (body.decision === "adopted" && !draft) {
      await draftFromCandidate(db, sub.id, cand, user.id);
      await logEvent(db, workspace.id, "feedback_comment_added", { source: "candidate" });
    }
    if (body.decision !== "adopted" && draft) await db.delete(feedbackItems).where(eq(feedbackItems.id, draft.id));
    await logEvent(db, workspace.id, "violation_candidate_reviewed", { decision: body.decision, reason: body.reason, has_note: !!body.note, rule_type: cand.ruleType, confidence: cand.confidence });
    return c.json({ ok: true });
  })
  // '놓친 위반 추가': 미탐 라벨로 저장되고 일반 피드백처럼 전달된다
  .post("/:id/missed", editorsOnly, async (c) => {
    const body = parse(feedbackBody.extend({ ruleId: z.string().min(1, "규칙을 골라 주세요.") }), await c.req.json());
    const db = c.var.db;
    const { sub, gi, guide, workspace, user } = await loadSub(c, c.req.param("id"));
    await assertUnlocked(db, sub);
    const rule = (await reviewRules(db, guide)).find((r) => r.id === body.ruleId);
    if (!rule) throw new ApiError(400, "validation_error", "규칙을 찾을 수 없어요.", { ruleId: "규칙을 골라 주세요." });
    await db.insert(feedbackItems).values({ id: newId(), submissionId: sub.id, frameId: body.frameId, tMs: body.tMs, shape: body.shape, text: body.text, source: "missed", ruleId: rule.id, authorId: user.id, createdAt: now() });
    await logEvents(db, workspace.id, [
      ["violation_missed_reported", { rule_type: rule.type }],
      ["feedback_comment_added", { source: "missed" }],
    ]);
    return c.json({ ok: true }, 201);
  })
  .post("/:id/frame-selected", async (c) => {
    const { workspace } = await loadSub(c, c.req.param("id"));
    await logEvent(c.var.db, workspace.id, "frame_selected", {});
    return c.json({ ok: true });
  });
