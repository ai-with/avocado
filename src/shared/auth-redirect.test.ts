import { describe, expect, it } from "vitest";
import { safeAuthNext } from "./auth-redirect";

describe("인증 뒤 복귀 경로", () => {
  it.each([null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/invite/token\r", "/.//evil.example", "/%2e//evil.example", "/%5cevil.example", "/%0a/evil.example", "/%7fevil.example"])("안전하지 않은 %s는 홈으로 보낸다", (raw) => {
    expect(safeAuthNext(raw)).toBe("/dashboard");
  });

  it.each(["/", "/invite/invite-token", "/invite/token?tab=join#accept", "/onboarding?next=%2Finvite%2Ftoken", "/dashboard/campaigns/g1"])("같은 사이트의 %s를 유지한다", (path) => {
    expect(safeAuthNext(path)).toBe(path);
  });
});
