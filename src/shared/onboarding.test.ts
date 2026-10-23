import { describe, expect, it } from "vitest";
import { onboardingSchema } from "./onboarding";

describe("onboardingSchema", () => {
  it("전체 답변과 건너뛰기를 통과시킨다", () => {
    const full = { teamSize: "6-20", role: "marketer", goals: ["review", "leads"], source: "지인 추천", website: "https://example.com" };
    expect(onboardingSchema.safeParse(full).success).toBe(true);
    expect(onboardingSchema.safeParse({ skipped: true }).success).toBe(true);
    expect(onboardingSchema.safeParse({ website: "" }).success).toBe(true);
  });
  it("목록에 없는 값과 잘못된 주소를 거부한다", () => {
    expect(onboardingSchema.safeParse({ teamSize: "1000" }).success).toBe(false);
    expect(onboardingSchema.safeParse({ goals: ["unknown"] }).success).toBe(false);
    expect(onboardingSchema.safeParse({ website: "javascript:alert(1)" }).success).toBe(false);
  });
  it("알게 된 경로는 100자까지", () => {
    expect(onboardingSchema.safeParse({ source: "가".repeat(101) }).success).toBe(false);
  });
});
