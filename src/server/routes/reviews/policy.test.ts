import { describe, expect, it } from "vitest";
import { addDecision, approveCheck, emptyStats, findConflicts, isLocked, nearAny, reviewState, suggestRewrite, type Mark } from "./policy";

const v = (id: string, version: number, status = "ready") => ({ id, version, status });
const approvedV2 = { submissionId: "s2", version: 2 };

describe("승인 뒤 새 버전 상태 전이", () => {
  it("승인 전에는 기존 상태 그대로", () => {
    expect(reviewState(v("s1", 1), null, false, false)).toBe("needs_review");
    expect(reviewState(v("s1", 1), null, true, false)).toBe("feedback_sent");
    expect(reviewState(v("s1", 1, "processing"), null, false, false)).toBe("processing");
  });
  it("승인된 버전은 approved, 그 뒤 버전은 after_approval, 유지로 닫으면 superseded", () => {
    expect(reviewState(v("s2", 2), approvedV2, true, false)).toBe("approved");
    expect(reviewState(v("s3", 3), approvedV2, false, false)).toBe("after_approval");
    expect(reviewState(v("s3", 3), approvedV2, true, false)).toBe("after_approval");
    expect(reviewState(v("s3", 3), approvedV2, false, true)).toBe("superseded");
    expect(reviewState(v("s3", 3, "uploaded"), approvedV2, false, false)).toBe("waiting");
  });
  it("승인 이전 버전은 원래 상태를 유지한다", () => {
    expect(reviewState(v("s1", 1), approvedV2, true, false)).toBe("feedback_sent");
  });
  it("잠금: 승인 버전과 이전 버전, 닫은 버전만 잠긴다", () => {
    expect(isLocked(v("s1", 1), null, false)).toBe(false);
    expect(isLocked(v("s2", 2), approvedV2, false)).toBe(true);
    expect(isLocked(v("s1", 1), approvedV2, false)).toBe(true);
    expect(isLocked(v("s3", 3), approvedV2, false)).toBe(false);
    expect(isLocked(v("s3", 3), approvedV2, true)).toBe(true);
  });
  it("승인 검사: 처음, 옮기기, 이미 승인, 이전 버전, 닫힘", () => {
    expect(approveCheck(v("s1", 1), null, false)).toBe("first");
    expect(approveCheck(v("s3", 3), approvedV2, false)).toBe("move");
    expect(approveCheck(v("s2", 2), approvedV2, false)).toBe("already_approved");
    expect(approveCheck(v("s1", 1), approvedV2, false)).toBe("older_than_approved");
    expect(approveCheck(v("s3", 3), approvedV2, true)).toBe("closed");
  });
});

describe("상충 판정", () => {
  const m = (id: string, tMs: number, stance: Mark["stance"], ruleId: string | null = "r1"): Mark => ({ id, tMs, ruleId, stance });
  it("같은 규칙을 1초 안에서 채택·기각하면 상충", () => {
    const r = findConflicts([m("a", 5000, "problem"), m("b", 5800, "ok")]);
    expect([...r.ids].sort()).toEqual(["a", "b"]);
    expect(r.times).toEqual([5000, 5800]);
  });
  it("1초를 넘거나 같은 판단이면 상충 아님", () => {
    expect(findConflicts([m("a", 5000, "problem"), m("b", 6001, "ok")]).ids.size).toBe(0);
    expect(findConflicts([m("a", 5000, "problem"), m("b", 5000, "problem")]).ids.size).toBe(0);
  });
  it("규칙이 다르면 상충 아님, 규칙 없는 코멘트는 어느 규칙과도 비교", () => {
    expect(findConflicts([m("a", 5000, "problem", "r1"), m("b", 5000, "ok", "r2")]).ids.size).toBe(0);
    expect(findConflicts([m("a", 5000, "problem", null), m("b", 5200, "ok", "r2")]).ids.size).toBe(2);
  });
  it("nearAny 는 창 안의 시각만 잡는다", () => {
    expect(nearAny(6000, [5000])).toBe(true);
    expect(nearAny(6001, [5000])).toBe(false);
  });
});

describe("기각 집계 임계값", () => {
  it("기각 3회 이상, 기각률 50% 이상이면 제안", () => {
    const st = emptyStats();
    addDecision(st, "rejected", "ambiguous");
    addDecision(st, "rejected", "ambiguous");
    addDecision(st, "adopted", null);
    expect(suggestRewrite(st)).toBe(false);
    addDecision(st, "rejected", null);
    expect(st).toMatchObject({ decided: 4, rejected: 3, reasons: { ambiguous: 2, other: 1 } });
    expect(suggestRewrite(st)).toBe(true);
  });
  it("채택이 더 많으면 제안하지 않고, 보류는 세지 않는다", () => {
    const st = emptyStats();
    for (let i = 0; i < 3; i++) addDecision(st, "rejected", "compliant");
    for (let i = 0; i < 4; i++) addDecision(st, "adopted", null);
    addDecision(st, "held", null);
    expect(st.decided).toBe(7);
    expect(suggestRewrite(st)).toBe(false);
  });
});
