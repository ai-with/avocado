import { describe, expect, it } from "vitest";
import { judgeRule, type DetectInput } from "./detect-rules";
import type { Seg, Verdict } from "../rules";
import { brandTermRule, legalTermRule, type BrandTerm } from "../../../shared/brand-terms";

const seg = (id: string, text: string): Seg => ({ id, startMs: 0, text, translatedText: null, lang: "ko" });
const term = (over: Partial<BrandTerm>): BrandTerm => ({ id: "t1", kind: "forbidden", term: "업계 1위", variants: [], suggestion: null, match: "exact", severity: "must", targets: ["speech"], note: "", enabled: true, ...over });
const fail = () => {
  throw new Error("모델을 부르면 안 돼요");
};
const input = (segs: Seg[], over: Partial<DetectInput> = {}): DetectInput =>
  ({ env: { get AI() { return fail(); } }, segs, noSpeech: null, visual: () => ({ result: "compliant", confidence: "medium", reason: "보이지 않아요.", frameIds: [] }), textModel: "t", visionModel: "v", ...over }) as unknown as DetectInput;

describe("사전 금지어", () => {
  it("변형어까지 문자열로 찾고 대체 표현을 이유에 붙인다 (모델 호출 없음)", async () => {
    const r = brandTermRule(term({ variants: ["넘버원"], suggestion: "많은 팀이 쓰는" }));
    const j = await judgeRule(r, input([seg("a", "이건 진짜 넘버 원 툴이에요"), seg("b", "좋아요")]));
    expect(j?.verdict.result).toBe("candidate");
    expect(j?.segmentIds).toEqual(["a"]);
    expect(j?.verdict.reason).toContain("'넘버원'이 나와요.");
    expect(j?.verdict.reason).toContain("대체 표현: 많은 팀이 쓰는");
    expect(j?.model).toBe("rule");
  });
  it("법규 금지어도 대사 매칭만 한다", async () => {
    const j = await judgeRule(legalTermRule({ id: "atopy", term: "아토피", variants: [], category: "disease", suggestion: null, basis: "" }), input([seg("a", "아토피에 좋아요")]));
    expect(j?.verdict.result).toBe("candidate");
    expect(j?.model).toBe("rule");
  });
});

describe("제품명 표기", () => {
  const r = brandTermRule(term({ kind: "product_name", term: "데모 워크플로", variants: ["데모워크플로우", "워크플로"] }));
  it("오표기가 나오면 '제품명 표기 오류: X 대신 Y'", async () => {
    const j = await judgeRule(r, input([seg("a", "데모 워크플로우 써 봤어요")]));
    expect(j?.verdict.result).toBe("candidate");
    expect(j?.verdict.reason).toContain("제품명 표기 오류: '데모워크플로우' 대신 '데모 워크플로'");
  });
  it("바른 이름 안에 든 약칭은 잡지 않는다", async () => {
    const j = await judgeRule(r, input([seg("a", "데모 워크플로 써 봤어요")]));
    expect(j?.verdict.result).toBe("compliant");
  });
  it("약칭만 따로 쓰면 잡는다", async () => {
    const j = await judgeRule(r, input([seg("a", "워크플로 최고")]));
    expect(j?.verdict.result).toBe("candidate");
  });
});

describe("필수 멘트·해시태그", () => {
  it("그대로 일치 필수 멘트는 문자열만 본다", async () => {
    const r = brandTermRule(term({ kind: "required_ment", term: "반복 업무를 줄여 줘요" }));
    expect((await judgeRule(r, input([seg("a", "반복 업무를 줄여줘요!")])))?.verdict.result).toBe("compliant");
    const miss = await judgeRule(r, input([seg("a", "좋아요")]));
    expect(miss?.verdict.result).toBe("candidate");
    expect(miss?.model).toBe("rule");
  });
  it("캡션 대상 해시태그는 판단 불가, 화면 텍스트는 프레임 표를 본다", async () => {
    const caption = brandTermRule(term({ kind: "hashtag", term: "#광고", targets: ["caption"] }));
    expect((await judgeRule(caption, input([seg("a", "안녕")])))?.verdict.result).toBe("undetermined");
    const screen = brandTermRule(term({ kind: "hashtag", term: "#광고", targets: ["screen_text"] }));
    const noSpeech: Verdict = { result: "undetermined", confidence: "low", reason: "음성이 없어요." };
    const visual = () => ({ result: "candidate" as const, confidence: "high" as const, reason: "안 보여요.", frameIds: ["f1"] });
    const j = await judgeRule(screen, input([], { noSpeech, visual }));
    expect(j?.verdict.result).toBe("candidate");
    expect(j?.frameIds).toEqual(["f1"]);
    expect(j?.model).toBe("v");
  });
});
