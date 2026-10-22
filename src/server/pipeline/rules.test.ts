import { describe, expect, it } from "vitest";
import { adDisclosureHits, aggregateVotes, checkFormat, detectLang, openingWindowMs, phraseHits, sampleFrames, splitTerms, toSentences, worst, type Seg } from "./rules";
import { contentFormatOf, fmtTimecode } from "../../shared/review";
import { parseFrameLines } from "../lib/ai";

const seg = (id: string, text: string, translatedText: string | null = null): Seg => ({ id, startMs: 0, text, translatedText, lang: "en" });

describe("toSentences", () => {
  it("구간 하나의 여러 문장을 글자 수 비율로 나눈다", () => {
    const out = toSentences([{ start: 10, end: 14, text: "Hi there. It cured my acne!" }]);
    expect(out.map((s) => s.text)).toEqual(["Hi there.", "It cured my acne!"]);
    expect(out[0]!.startMs).toBe(10000);
    expect(out[1]!.endMs).toBe(14000);
    expect(out[0]!.endMs).toBe(out[1]!.startMs);
    expect(out[0]!.endMs).toBeGreaterThan(10000);
  });
  it("빈 구간은 버린다", () => {
    expect(toSentences([{ start: 0, end: 1, text: "  " }])).toEqual([]);
  });
});

describe("detectLang", () => {
  it("한글 비율로 정하고 글자가 없을 때만 모델 힌트를 쓴다", () => {
    expect(detectLang("It cured my acne", "ko")).toBe("en");
    expect(detectLang("123", "EN")).toBe("en");
    expect(detectLang("안녕하세요 여러분 skincare", null)).toBe("ko");
    expect(detectLang("hello everyone", null)).toBe("en");
  });
});

describe("phraseHits", () => {
  it("대소문자·공백을 무시하고 원문과 번역에서 찾는다 (F-61 수용 기준 cure)", () => {
    const segs = [seg("a", "It CURED my acne"), seg("b", "nothing here", "여드름이 완 치 됐어요")];
    expect(phraseHits(segs, splitTerms("cure, 완치")).ids.sort()).toEqual(["a", "b"]);
    expect(phraseHits(segs, ["miracle"]).ids).toEqual([]);
  });
});

describe("adDisclosureHits", () => {
  it("짧은 영어 단어는 단어 경계로만 맞춘다", () => {
    expect(adDisclosureHits([seg("a", "This is an #ad")])).toEqual(["a"]);
    expect(adDisclosureHits([seg("a", "I added toner")])).toEqual([]);
    expect(adDisclosureHits([seg("a", "협찬 받은 제품이에요")])).toEqual(["a"]);
  });
});

describe("checkFormat", () => {
  it("길이와 세로 비율을 메타데이터로 계산한다", () => {
    expect(checkFormat("세로 9:16, 60초 이하", { durationS: 45, width: 720, height: 1280 })?.result).toBe("compliant");
    expect(checkFormat("세로 9:16, 60초 이하", { durationS: 75, width: 720, height: 1280 })?.result).toBe("candidate");
    expect(checkFormat("vertical", { durationS: 10, width: 1920, height: 1080 })?.result).toBe("candidate");
    expect(checkFormat("15초 이상", { durationS: 10, width: 1, height: 2 })?.result).toBe("candidate");
    expect(checkFormat("세로", { durationS: null, width: null, height: null })?.result).toBe("undetermined");
    expect(checkFormat("자연스럽게", { durationS: 10, width: 1, height: 2 })).toBeNull();
  });
  it("첫 N초 구간을 읽는다", () => {
    expect(openingWindowMs("첫 3초 안에 제품 노출")).toBe(3000);
    expect(openingWindowMs("세로 영상")).toBeNull();
  });
});

describe("sampleFrames", () => {
  it("균등 n장 + 구간 안 프레임을 시간순으로 고른다", () => {
    const all = Array.from({ length: 60 }, (_, i) => ({ tMs: i * 1000 }));
    const picked = sampleFrames(all, 12, 3000);
    expect(picked[0]!.tMs).toBe(0);
    expect(picked.at(-1)!.tMs).toBe(59000);
    expect(picked.filter((f) => f.tMs <= 3000).length).toBe(4);
    expect(sampleFrames(all.slice(0, 5), 12, null).length).toBe(5);
  });
});

describe("aggregateVotes · worst", () => {
  it("필수 장면은 한 장이라도 확실하면 준수, 없으면 위반 후보", () => {
    expect(aggregateVotes("required", [{ frameId: "f", yes: true, confidence: "high" }], 1).result).toBe("compliant");
    expect(aggregateVotes("required", [{ frameId: "f", yes: false, confidence: "high" }], 1).result).toBe("candidate");
    expect(aggregateVotes("forbidden", [{ frameId: "f", yes: true, confidence: "low" }], 1).result).toBe("needs_check");
    expect(aggregateVotes("forbidden", [], 3).result).toBe("undetermined");
  });
  it("더 나쁜 판정을 고른다", () => {
    expect(worst({ result: "compliant", confidence: "high", reason: "a" }, { result: "candidate", confidence: "medium", reason: "b" }).result).toBe("candidate");
  });
});

describe("shared/review", () => {
  it("타임코드와 게시물 형식", () => {
    expect(fmtTimecode(74_500)).toBe("01:14");
    expect(contentFormatOf("https://www.instagram.com/reel/abc/")).toBe("reel");
    expect(contentFormatOf("https://www.instagram.com/p/abc/")).toBe("feed");
    expect(contentFormatOf("https://youtu.be/x")).toBe("unknown");
  });
});

describe("parseFrameLines", () => {
  it("질문 번호별 yes/no/maybe 줄을 읽고 형식이 없으면 실패한다", () => {
    expect(parseFrameLines("q1: yes\nq2: No\nQ3 - maybe", ["a", "b", "c"])).toEqual([
      { id: "a", yes: true, confidence: "medium" },
      { id: "b", yes: false, confidence: "medium" },
      { id: "c", yes: true, confidence: "low" },
    ]);
    expect(() => parseFrameLines("I cannot tell", ["a"])).toThrow();
  });
});
