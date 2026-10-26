import { describe, expect, it } from "vitest";
import { josa, withJosa } from "./josa";

describe("josa", () => {
  it("한글 받침", () => {
    expect(withJosa("크림", "을/를")).toBe("크림을");
    expect(withJosa("세럼", "이/가")).toBe("세럼이");
    expect(withJosa("토너", "을/를")).toBe("토너를");
    expect(withJosa("토너", "은/는")).toBe("토너는");
    expect(withJosa("사과", "과/와")).toBe("사과와");
    expect(withJosa("빵", "과/와")).toBe("빵과");
  });
  it("으로/로: ㄹ 받침과 받침 없음은 로", () => {
    expect(withJosa("편집자", "으로/로")).toBe("편집자로");
    expect(withJosa("관리자", "으로/로")).toBe("관리자로");
    expect(withJosa("서울", "으로/로")).toBe("서울로");
    expect(withJosa("소유권", "으로/로")).toBe("소유권으로");
  });
  it("숫자·영문 근사", () => {
    expect(josa("3", "을/를")).toBe("을");
    expect(josa("2", "을/를")).toBe("를");
    expect(josa("1", "으로/로")).toBe("로");
    expect(josa("Notion", "이/가")).toBe("이");
    expect(josa("Excel", "으로/로")).toBe("로");
    expect(josa("Figma", "을/를")).toBe("를");
  });
  it("끝 문장부호는 건너뛴다, 빈 문자열은 받침 없음", () => {
    expect(josa("크림)", "을/를")).toBe("을");
    expect(josa("", "을/를")).toBe("를");
  });
});
