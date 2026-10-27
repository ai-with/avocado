import { and, inArray, isNotNull, ne } from "drizzle-orm";
import type { Db } from "../../db";
import { feedbackItems, frames, transcriptSegments, violationCandidates } from "../../db/schema";
import { selectInChunks } from "../../lib/chunks";
import { findConflicts, stanceOfDecision, type Mark } from "./policy";

// 버전마다 판단이 엇갈린 항목 (337). 판정 규칙은 policy.ts findConflicts

export type Conflicts = { ids: string[]; times: number[] };
type DecidedCandidate = { id: string; sub: string; ruleId: string; decision: Mark["stance"]; frameId: string | null; segmentId: string | null };

// 후보 시각: 첫 근거 프레임, 없으면 첫 근거 대사 시작
async function candidateTimes(db: Db, cands: DecidedCandidate[]) {
  const frameIds = cands.map((c) => c.frameId).filter((x): x is string => !!x);
  const segIds = cands.filter((c) => !c.frameId && c.segmentId).map((c) => c.segmentId as string);
  const f = await selectInChunks(frameIds, (part) => db.select({ id: frames.id, t: frames.tMs }).from(frames).where(inArray(frames.id, part)));
  const s = await selectInChunks(segIds, (part) => db.select({ id: transcriptSegments.id, t: transcriptSegments.startMs }).from(transcriptSegments).where(inArray(transcriptSegments.id, part)));
  return new Map([...f, ...s].map((x) => [x.id, x.t]));
}

async function decidedCandidates(db: Db, subIds: string[]): Promise<DecidedCandidate[]> {
  const rows = await selectInChunks(subIds, (part) =>
    db
      .select({ id: violationCandidates.id, sub: violationCandidates.submissionId, ruleId: violationCandidates.ruleId, decision: violationCandidates.decision, frameIds: violationCandidates.frameIds, segmentIds: violationCandidates.segmentIds })
      .from(violationCandidates)
      .where(and(inArray(violationCandidates.submissionId, part), isNotNull(violationCandidates.decision))),
  );
  return rows.flatMap((r) => {
    const stance = stanceOfDecision(r.decision);
    return stance ? [{ id: r.id, sub: r.sub, ruleId: r.ruleId, decision: stance, frameId: r.frameIds[0] ?? null, segmentId: r.segmentIds[0] ?? null }] : [];
  });
}

export async function conflictsOf(db: Db, subIds: string[]): Promise<Map<string, Conflicts>> {
  if (!subIds.length) return new Map();
  const cands = await decidedCandidates(db, subIds);
  const timeOf = await candidateTimes(db, cands);
  // 채택 후보에서 만든 코멘트는 후보와 같은 판단이라 뺀다
  const comments = await selectInChunks(subIds, (part) =>
    db
      .select({ id: feedbackItems.id, sub: feedbackItems.submissionId, tMs: feedbackItems.tMs, ruleId: feedbackItems.ruleId })
      .from(feedbackItems)
      .where(and(inArray(feedbackItems.submissionId, part), ne(feedbackItems.source, "candidate"))),
  );
  const marks = new Map<string, Mark[]>();
  const push = (sub: string, m: Mark) => marks.set(sub, [...(marks.get(sub) ?? []), m]);
  for (const c of cands) {
    const t = timeOf.get(c.frameId ?? c.segmentId ?? "");
    if (t !== undefined) push(c.sub, { id: c.id, tMs: t, ruleId: c.ruleId, stance: c.decision });
  }
  for (const m of comments) push(m.sub, { id: m.id, tMs: m.tMs, ruleId: m.ruleId, stance: "problem" });
  const out = new Map<string, Conflicts>();
  for (const [sub, list] of marks) {
    const r = findConflicts(list);
    if (r.ids.size) out.set(sub, { ids: [...r.ids], times: r.times });
  }
  return out;
}
