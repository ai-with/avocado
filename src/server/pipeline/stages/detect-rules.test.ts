import { describe, expect, it } from "vitest";
import { competitorMention, judgeRule, type DetectInput } from "./detect-rules";
import type { Seg, Verdict } from "../rules";
import type { GuideRule, RuleTarget } from "../../../shared/guides";

const seg = (id: string, text: string): Seg => ({ id, startMs: 0, text, translatedText: null, lang: "ko" });
const rule = (content: string, targets: RuleTarget[] = ["speech"]): GuideRule => ({ id: "r1", type: "competitor_mention", content, severity: "must", targets, enabled: true });
const input = (segs: Seg[], over: Partial<DetectInput> = {}): DetectInput =>
  ({ segs, noSpeech: null, visual: () => ({ result: "compliant", confidence: "medium", reason: "보이지 않아요.", frameIds: [] }), textModel: "t", visionModel: "v", ...over }) as DetectInput;

describe("competitorMention 대사 매칭", () => {
  it("영문은 대소문자·공백을 무시한다", () => {
    const j = competitorMention(rule("Notion AI"), input([seg("a", "저는 notionai 도 써 봤어요"), seg("b", "좋아요")]));
    expect(j.verdict.result).toBe("candidate");
    expect(j.segmentIds).toEqual(["a"]);
    expect(j.verdict.reason).toContain("경쟁사 이름 'Notion AI'가 나와요.");
  });
  it("한글은 부분 일치, 여러 이름(쉼표·줄바꿈)을 모두 찾고 조사를 맞춘다", () => {
    const j = competitorMention(rule("토스, 카카오페이\n네이버"), input([seg("a", "토스에서 보내면"), seg("b", "카카오페이로도 돼요")]));
    expect(j.segmentIds).toEqual(["a", "b"]);
    expect(j.verdict.reason).toContain("'토스'가 나와요.");
    expect(j.verdict.reason).toContain("'카카오페이'가 나와요.");
    expect(j.verdict.reason).not.toContain("네이버");
  });
  it("이름이 없으면 준수", () => {
    const j = competitorMention(rule("토스"), input([seg("a", "우리 앱으로 보내요")]));
    expect(j.verdict.result).toBe("compliant");
    expect(j.segmentIds).toEqual([]);
  });
  it("화면 텍스트 표가 위반이면 후보, 대사가 없으면 화면만 본다", async () => {
    const noSpeech: Verdict = { result: "undetermined", confidence: "low", reason: "음성이 없어요." };
    const visual = () => ({ result: "candidate" as const, confidence: "high" as const, reason: "2개 프레임에서 보여요.", frameIds: ["f1"] });
    const j = await judgeRule(rule("토스", ["speech", "screen_text"]), input([], { noSpeech, visual }));
    expect(j?.verdict.result).toBe("candidate");
    expect(j?.frameIds).toEqual(["f1"]);
    expect(j?.model).toBe("v");
  });
});
