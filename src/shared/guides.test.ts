import { describe, expect, it } from "vitest";
import { checkUpload, checklistFromRules, emptyVideoGuide, forbiddenTerms, isTokenExpired, lineWarnings, makeSlug, missingConsent, ruleConflicts, DEFAULT_AD_RULE } from "./guides";

const rule = (type: Parameters<typeof ruleConflicts>[0][number]["type"], content: string, enabled = true) => ({ type, content, enabled });

describe("ruleConflicts", () => {
  it("필수 문구와 금지 표현이 겹치면 경고", () => {
    const w = ruleConflicts([rule("required_phrase", "피부 진정 효과"), rule("forbidden_phrase", "진정"), DEFAULT_AD_RULE]);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("겹칩니다");
  });
  it("꺼진 규칙은 보지 않고, 광고 표기가 없으면 경고", () => {
    expect(ruleConflicts([rule("required_phrase", "진정"), rule("forbidden_phrase", "진정", false), DEFAULT_AD_RULE])).toEqual([]);
    expect(ruleConflicts([])).toEqual(["광고 표기 규칙이 없어요. 국가별 표기 의무를 확인하세요."]);
  });
});

describe("makeSlug", () => {
  it("영문은 소문자 하이픈, 한글이면 랜덤", () => {
    expect(makeSlug("Summer Glow Serum!", () => "rand01")).toBe("summer-glow-serum");
    expect(makeSlug("여름 세럼 캠페인", () => "rand01")).toBe("rand01");
    expect(makeSlug("ab", () => "rand01")).toBe("rand01");
  });
});

describe("isTokenExpired", () => {
  it("만료 시각 이후면 만료", () => {
    expect(isTokenExpired(1000, 999)).toBe(false);
    expect(isTokenExpired(1000, 1000)).toBe(true);
  });
});

describe("대사 경고와 체크리스트", () => {
  it("금지 표현이 들어간 대사만 표시", () => {
    const g = emptyVideoGuide();
    g.scenes[0]!.lineKo = "이거 쓰고 여드름 완치됐어요";
    g.scenes[1]!.lineEn = "Feels so fresh";
    const terms = forbiddenTerms([rule("forbidden_phrase", "치료, 완치")]);
    expect(terms).toEqual(["치료", "완치"]);
    expect(lineWarnings(g, terms)).toHaveLength(1);
  });
  it("체크리스트는 켜진 규칙만", () => {
    const list = checklistFromRules([{ ...DEFAULT_AD_RULE }, { type: "required_phrase", content: "제품명", severity: "should", enabled: false }]);
    expect(list).toEqual([`[필수] 광고 표기: ${DEFAULT_AD_RULE.content}`]);
  });
});

describe("업로드·동의 검증", () => {
  it("형식, 2GB, 3분", () => {
    expect(checkUpload("a.MP4", 10, 60)).toEqual({ ok: true });
    expect(checkUpload("a.avi", 10, 60)).toEqual({ ok: false, reason: "bad_format" });
    expect(checkUpload("a.mov", 3 * 1024 ** 3, 60)).toEqual({ ok: false, reason: "too_large" });
    expect(checkUpload("a.webm", 10, 181)).toEqual({ ok: false, reason: "too_long" });
  });
  it("필수 동의 누락 목록, 2차 활용은 선택", () => {
    const all = { collect: true, purpose_review: true, purpose_stt: true, automated: true, transfer: true, retention: true };
    expect(missingConsent(all)).toEqual([]);
    expect(missingConsent({ ...all, transfer: false })).toEqual(["transfer"]);
  });
});

describe("경쟁사 언급 금지", () => {
  it("초안 경고 단어에 경쟁사 이름(쉼표·줄바꿈)을 넣고 체크리스트 접두를 붙인다", () => {
    const rules = [rule("forbidden_phrase", "완치"), rule("competitor_mention", "토스,\nKakaoPay")];
    expect(forbiddenTerms(rules)).toEqual(["완치", "토스", "KakaoPay"]);
    const g = emptyVideoGuide();
    g.scenes[0]!.lineEn = "Better than kakaopay";
    expect(lineWarnings(g, forbiddenTerms(rules))).toHaveLength(1);
    expect(checklistFromRules([{ type: "competitor_mention", content: "토스", severity: "must", enabled: true }])).toEqual(["[필수] 경쟁사 언급 안 하기: 토스"]);
  });
});
