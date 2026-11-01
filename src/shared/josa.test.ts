import { describe, expect, it } from "vitest";
import { fixJosaAfter, josa, withJosa } from "./josa";

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

describe("fixJosaAfter (AIWITH-567)", () => {
  it("받침 있음/없음/ㄹ 받침", () => {
    expect(fixJosaAfter("크림", "예요")).toBe("이에요");
    expect(fixJosaAfter("토너", "이에요.")).toBe("예요.");
    expect(fixJosaAfter("서울", "예요")).toBe("이에요");
    expect(fixJosaAfter("서울", "로")).toBe("로");
    expect(fixJosaAfter("서울", "으로서")).toBe("로서");
    expect(fixJosaAfter("크림", "로써")).toBe("으로써");
  });
  it("조사로 시작하지 않으면 그대로", () => {
    expect(fixJosaAfter("크림", "")).toBe("");
    expect(fixJosaAfter("크림", " 가")).toBe(" 가");
    expect(fixJosaAfter("크림", "이번 주")).toBe("이번 주");
    expect(fixJosaAfter("크림", "가방")).toBe("가방");
  });
  it("병기형은 뒤 글자와 상관없이 고른다", () => {
    expect(fixJosaAfter("크림", "을/를위해")).toBe("을위해");
    expect(fixJosaAfter("토너", "(이)라고요")).toBe("라고요");
  });
  it("값 끝 문장부호는 건너뛴다", () => {
    expect(fixJosaAfter("크림)", "가 ")).toBe("이 ");
  });
});
