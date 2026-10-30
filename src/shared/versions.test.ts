import { describe, expect, it } from "vitest";
import { assignVersion, groupVersions, type VersionSub } from "./versions";

const none = { approvedId: null, supersededIds: new Set<string>(), sentIds: new Set<string>() };
const sub = (id: string, version: number, kind: "final" | "clean", createdAt: number, status = "ready"): VersionSub => ({ id, version, kind, status, uploadedAt: createdAt, createdAt });

describe("assignVersion", () => {
  it("완성본은 최근 완성본 + 1로 이어진다", () => {
    expect(assignVersion("final", 0)).toBe(1);
    expect(assignVersion("final", 2)).toBe(3);
  });
  it("클린본은 가장 최근 완성본 버전에 붙는다", () => {
    expect(assignVersion("clean", 2)).toBe(2);
  });
  it("완성본 없이 올린 클린본은 v1, 그 뒤 첫 완성본도 v1", () => {
    expect(assignVersion("clean", 0)).toBe(1);
    expect(assignVersion("final", 0)).toBe(1);
  });
});

describe("groupVersions", () => {
  it("버전별 한 줄, 최신순, 같은 버전 클린본 재업로드는 하나로", () => {
    const rows = groupVersions([sub("f1", 1, "final", 1), sub("c1", 1, "clean", 2), sub("f2", 2, "final", 3), sub("c2a", 2, "clean", 4), sub("c2b", 2, "clean", 5)], none);
    expect(rows.map((r) => [r.version, r.hasFinal, r.hasClean, r.finalId])).toEqual([
      [2, true, true, "f2"],
      [1, true, true, "f1"],
    ]);
  });
  it("완성본 없는 버전, 취소·올리는 중 처리", () => {
    const rows = groupVersions([sub("c1", 1, "clean", 1), sub("x", 2, "final", 2, "aborted"), sub("c-up", 1, "clean", 3, "uploading")], none);
    expect(rows).toEqual([{ version: 1, uploadedAt: 1, finalId: null, hasFinal: false, hasClean: true, state: "reviewing" }]);
  });
  it("상태: 승인, 기존 승인 유지, 피드백 받음, 올리는 중", () => {
    const marks = { approvedId: "f1", supersededIds: new Set(["f2"]), sentIds: new Set(["f3"]) };
    const rows = groupVersions([sub("f1", 1, "final", 1), sub("f2", 2, "final", 2), sub("f3", 3, "final", 3), sub("f4", 4, "final", 4, "uploading")], marks);
    expect(rows.map((r) => r.state)).toEqual(["uploading", "feedback", "kept_previous", "approved"]);
  });
});
