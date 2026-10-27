import { CONFLICT_WINDOW_MS, nearAny, type CandidateDecision, type DecisionReason, type ReviewState } from "../../../shared/review";

// 검수 판정 규칙 (순수 함수). 라우트는 DB 에서 읽은 값을 넘기기만 한다

// ---- 승인 뒤 새 버전 (340) ----

export type ApprovedRef = { submissionId: string; version: number } | null;
type SubRef = { id: string; version: number };

// 승인된 버전보다 나중에 올라온 버전인가
const isAfterApproval = (s: SubRef, approved: ApprovedRef) => !!approved && approved.submissionId !== s.id && s.version > approved.version;

export function reviewState(s: SubRef & { status: string }, approved: ApprovedRef, sent: boolean, superseded: boolean): ReviewState {
  if (approved?.submissionId === s.id) return "approved";
  if (s.status === "uploaded") return "waiting";
  if (s.status === "processing") return "processing";
  if (isAfterApproval(s, approved)) return superseded ? "superseded" : "after_approval";
  if (sent) return "feedback_sent";
  return "needs_review";
}

// 코멘트·후보 판정을 바꿀 수 없는 버전: 승인된 버전과 그 이전 버전, '기존 승인 유지'로 닫은 버전
export function isLocked(s: SubRef, approved: ApprovedRef, superseded: boolean): boolean {
  if (!approved) return false;
  return !isAfterApproval(s, approved) || superseded;
}

export type ApproveCheck = "first" | "move" | "already_approved" | "older_than_approved" | "closed";

// 최종 승인 가능 여부. move 는 승인을 새 버전으로 옮긴다
export function approveCheck(s: SubRef, approved: ApprovedRef, superseded: boolean): ApproveCheck {
  if (!approved) return "first";
  if (approved.submissionId === s.id) return "already_approved";
  if (!isAfterApproval(s, approved)) return "older_than_approved";
  return superseded ? "closed" : "move";
}

// ---- 상충 코멘트 (337) ----

export { CONFLICT_WINDOW_MS, nearAny };

// problem: 고쳐야 한다(채택한 후보, 직접 쓴 코멘트, 놓친 위반), ok: 문제없다(기각한 후보)
export type Stance = "problem" | "ok";
export type Mark = { id: string; tMs: number; ruleId: string | null; stance: Stance };

export function stanceOfDecision(decision: CandidateDecision | null): Stance | null {
  if (decision === "adopted") return "problem";
  if (decision === "rejected") return "ok";
  return null;
}

// 규칙이 같거나 한쪽이 규칙 없는 코멘트면 같은 대상을 두고 판단한 것으로 본다
const sameTarget = (a: Mark, b: Mark) => a.ruleId === b.ruleId || a.ruleId === null || b.ruleId === null;

// 가까운 장면에서 반대 판단을 한 항목 id 와 그 장면 시각
export function findConflicts(marks: Mark[]): { ids: Set<string>; times: number[] } {
  const ids = new Set<string>();
  const times = new Set<number>();
  marks.forEach((a, i) => {
    for (const b of marks.slice(i + 1)) {
      if (a.stance === b.stance || Math.abs(a.tMs - b.tMs) > CONFLICT_WINDOW_MS || !sameTarget(a, b)) continue;
      ids.add(a.id).add(b.id);
      times.add(a.tMs).add(b.tMs);
    }
  });
  return { ids, times: [...times].sort((x, y) => x - y) };
}


// ---- 기각 사유 집계 (338) ----

// 기각이 이만큼 쌓이고 비율이 이 이상이면 규칙 문구를 고쳐 보라고 제안한다
export const REWRITE_MIN_REJECTS = 3;
export const REWRITE_MIN_RATE = 0.5;

export type RuleDecisionStats = { decided: number; rejected: number; reasons: Record<DecisionReason, number> };

export const emptyStats = (): RuleDecisionStats => ({ decided: 0, rejected: 0, reasons: { compliant: 0, irrelevant: 0, ambiguous: 0, other: 0 } });

// 보류·미판정은 세지 않는다
export function addDecision(st: RuleDecisionStats, decision: CandidateDecision | null, reason: DecisionReason | null): void {
  if (decision !== "adopted" && decision !== "rejected") return;
  st.decided += 1;
  if (decision === "rejected") {
    st.rejected += 1;
    st.reasons[reason ?? "other"] += 1;
  }
}

export const suggestRewrite = (st: RuleDecisionStats) => st.rejected >= REWRITE_MIN_REJECTS && st.rejected / st.decided >= REWRITE_MIN_RATE;
