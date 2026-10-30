import { describe, expect, it } from "vitest";
import { initialKind, needsFinalNotice } from "./kindChoice";

describe("initialKind", () => {
  it("저장된 업로드 종류를 고르고, 없으면 기본값", () => {
    expect(initialKind((k) => k === "clean")).toBe("clean");
    expect(initialKind(() => true)).toBe("final");
    expect(initialKind(() => false)).toBe("final");
    expect(initialKind(() => false, "clean")).toBe("clean");
  });
});

describe("needsFinalNotice", () => {
  it("완성본 없이 클린본을 고를 때만 안내", () => {
    expect(needsFinalNotice("clean", false)).toBe(true);
    expect(needsFinalNotice("clean", true)).toBe(false);
    expect(needsFinalNotice("final", false)).toBe(false);
  });
});
