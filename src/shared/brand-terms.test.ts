import { describe, expect, it } from "vitest";
import { brandTermRules, publicDictionary, ruleSource, type BrandTerm } from "./brand-terms";
import { COSMETIC_AD_TERMS, type LegalTerm } from "./cosmetic-ad-terms";

const term = (over: Partial<BrandTerm>): BrandTerm => ({ id: "t1", kind: "forbidden", term: "업계 1위", variants: [], suggestion: null, match: "exact", severity: "must", targets: ["speech"], note: "", enabled: true, ...over });
const LEGAL: LegalTerm[] = [
  { id: "atopy", term: "아토피", variants: ["atopic"], category: "disease", suggestion: null, basis: "" },
  { id: "best", term: "최고", variants: [], category: "absolute", suggestion: null, basis: "" },
];
const ON = { enabled: true, disabled: [] };

describe("brandTermRules", () => {
  it("종류별로 규칙 종류·내용을 바꾸고 id 는 bt:, legal: 로 고정한다", () => {
    const rules = brandTermRules(
      [
        term({ id: "a", kind: "required_ment", term: "반복 업무를 줄여 줘요", match: "similar" }),
        term({ id: "b", kind: "forbidden", term: "무조건", variants: ["100% 보장"] }),
        term({ id: "c", kind: "hashtag", term: "#광고", targets: ["caption"] }),
        term({ id: "d", kind: "product_name", term: "데모 워크플로", variants: ["데모 플로"] }),
      ],
      ON,
      [],
      LEGAL,
    );
    expect(rules.map((r) => [r.id, r.type, r.content])).toEqual([
      ["bt:a", "required_phrase", "반복 업무를 줄여 줘요"],
      ["bt:b", "forbidden_phrase", "무조건, 100% 보장"],
      ["bt:c", "required_phrase", "#광고"],
      ["bt:d", "forbidden_phrase", "데모 워크플로 (오표기: 데모 플로)"],
      ["legal:atopy", "forbidden_phrase", "아토피, atopic"],
      ["legal:best", "forbidden_phrase", "최고"],
    ]);
    expect(rules[0]?.origin.exact).toBe(false);
    expect(rules.find((r) => r.id === "legal:best")?.severity).toBe("should");
    expect(rules.map((r) => ruleSource(r.id))).toEqual(["brand", "brand", "brand", "brand", "legal", "legal"]);
  });

  it("꺼진 항목, 브랜드에서 끈 법규 항목, 캠페인에서 끈 규칙은 빠진다", () => {
    const terms = [term({ id: "a" }), term({ id: "b", enabled: false }), term({ id: "c" })];
    const ids = brandTermRules(terms, { enabled: true, disabled: ["best"] }, ["bt:c"], LEGAL).map((r) => r.id);
    expect(ids).toEqual(["bt:a", "legal:atopy"]);
  });

  it("법규 기본 목록 전체를 끄면 법규 규칙이 없다", () => {
    expect(brandTermRules([], { enabled: false, disabled: [] }, [], LEGAL)).toEqual([]);
  });

  it("공개 가이드 묶음은 출처·종류별로 나눈다", () => {
    const rules = brandTermRules([term({ id: "a", suggestion: "많은 팀이 쓰는" }), term({ id: "b", kind: "hashtag", term: "#광고" })], ON, [], LEGAL);
    const d = publicDictionary(rules);
    expect(d.forbidden).toEqual([{ term: "업계 1위", variants: [], suggestion: "많은 팀이 쓰는" }]);
    expect(d.hashtags).toEqual(["#광고"]);
    expect(d.legal.map((l) => l.term)).toEqual(["아토피", "최고"]);
  });

  it("법규 기본 목록은 id 가 겹치지 않고 근거가 있다", () => {
    const ids = COSMETIC_AD_TERMS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(COSMETIC_AD_TERMS.length).toBeGreaterThanOrEqual(30);
    expect(COSMETIC_AD_TERMS.every((t) => t.basis.includes("화장품법") && /S\d/.test(t.basis))).toBe(true);
  });
});
