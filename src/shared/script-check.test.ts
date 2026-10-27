import { describe, expect, it } from "vitest";
import { dropSentences, foreignChars, hasForeignChars, hasInternalTerm } from "./script-check";

describe("foreignChars", () => {
  it.each([
    ["제품 사용效果 소개", ["效", "果"]],
    ["자연光을 이용해요", ["光"]],
    ["人が 챙기기 전에", ["人", "が"]],
    ["사용법과ประโยชน을", ["ป", "ร", "ะ", "โ", "ย", "ช", "น"]],
    ["カタカナ", ["カ", "タ", "ナ"]],
  ])("%s 에서 외국 문자를 찾는다", (text, chars) => {
    expect(foreignChars(text)).toEqual(chars);
  });
  it("한글·영문·숫자·문장부호·이모지는 통과한다", () => {
    expect(hasForeignChars("Galaxy S25 Ultra로 9:16 세로 촬영! (100%) \"좋아요\" ✨👍🏻 #광고 · 1/3 ok")).toBe(false);
    expect(hasForeignChars("👨‍👩‍👧 가족과 함께 ❤️")).toBe(false);
  });
  it("영어 기준이면 한글도 걸린다", () => {
    expect(hasForeignChars("Try it today", "en")).toBe(false);
    expect(foreignChars("Try 토스 today", "en")).toEqual(["토", "스"]);
  });
  it("허용 글자(입력에 있던 제품 이름)는 통과한다", () => {
    expect(hasForeignChars("無印良品 수납함을 써 봐요", "ko", "無印良品")).toBe(false);
    expect(hasForeignChars("Try 토스 today", "en", "토스")).toBe(false);
  });
});

describe("dropSentences", () => {
  it("걸린 문장만 뺀다", () => {
    const text = "밝은 곳에서 찍어요. 自然光을 쓰세요. 세로로 찍어요.";
    expect(dropSentences(text, (s) => hasForeignChars(s))).toBe("밝은 곳에서 찍어요. 세로로 찍어요.");
  });
});

describe("hasInternalTerm", () => {
  it("광고 소재·UGC 같은 내부 용어를 찾는다", () => {
    expect(hasInternalTerm("광고 소재용 UGC 콘텐츠를 제작해보세요")).toBe(true);
    expect(hasInternalTerm("ugc 영상")).toBe(true);
    expect(hasInternalTerm("제품을 직접 써 보는 후기 영상")).toBe(false);
  });
});
