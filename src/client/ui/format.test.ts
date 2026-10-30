import { describe, expect, it } from "vitest";
import { addTags, countChars, countLabel, digitsOnly, formatDecimalInput, formatNumberInput, groupThousands, normalizeDecimalInput, parseDecimalInput, parseNumberInput } from "./format";

describe("숫자·금액 서식", () => {
  it("숫자만 남기고 앞자리 0을 지운다", () => {
    expect(digitsOnly("₩ 1,200원")).toBe("1200");
    expect(digitsOnly("0012")).toBe("12");
    expect(digitsOnly("000")).toBe("0");
    expect(digitsOnly("abc")).toBe("");
  });
  it("15자리를 넘으면 자른다", () => {
    expect(digitsOnly("1234567890123456789")).toHaveLength(15);
  });
  it("천 단위 쉼표", () => {
    expect(groupThousands("1234567")).toBe("1,234,567");
    expect(groupThousands("999")).toBe("999");
    expect(groupThousands("1000")).toBe("1,000");
  });
  it("값과 표시 글자를 오간다", () => {
    expect(formatNumberInput(null)).toBe("");
    expect(formatNumberInput(1500000)).toBe("1,500,000");
    expect(parseNumberInput("1,500,000")).toBe(1500000);
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("원")).toBeNull();
  });
});

describe("소수 입력", () => {
  it("정수 부분에만 천 단위 쉼표", () => {
    expect(normalizeDecimalInput("1234.5")).toBe("1,234.5");
    expect(normalizeDecimalInput("1,234.56789")).toBe("1,234.56789");
    expect(normalizeDecimalInput("1234567")).toBe("1,234,567");
  });
  it("입력 중간 상태를 지우지 않는다", () => {
    expect(normalizeDecimalInput("12.")).toBe("12.");
    expect(normalizeDecimalInput("0.0")).toBe("0.0");
    expect(normalizeDecimalInput(".5")).toBe(".5");
    expect(normalizeDecimalInput("")).toBe("");
  });
  it("앞자리 0은 하나만 남긴다", () => {
    expect(normalizeDecimalInput("007")).toBe("7");
    expect(normalizeDecimalInput("00.5")).toBe("0.5");
  });
  it("점 두 개, 다른 글자, 자리 초과는 받지 않는다", () => {
    expect(normalizeDecimalInput("1.2.3")).toBeNull();
    expect(normalizeDecimalInput("12a")).toBeNull();
    expect(normalizeDecimalInput("-1")).toBeNull();
    expect(normalizeDecimalInput("1.234", 2)).toBeNull();
    expect(normalizeDecimalInput("1.23", 2)).toBe("1.23");
    expect(normalizeDecimalInput("1234567890123456")).toBeNull();
  });
  it("표시 글자를 값으로", () => {
    expect(parseDecimalInput(".5")).toBe(0.5);
    expect(parseDecimalInput("12.")).toBe(12);
    expect(parseDecimalInput("1,234.5")).toBe(1234.5);
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput(".")).toBeNull();
  });
  it("값을 표시 글자로", () => {
    expect(formatDecimalInput(1234.5)).toBe("1,234.5");
    expect(formatDecimalInput(null)).toBe("");
    expect(formatDecimalInput(0)).toBe("0");
  });
});

describe("글자 수", () => {
  it("보이는 글자 단위로 센다", () => {
    expect(countChars("")).toBe(0);
    expect(countChars("안녕하세요")).toBe(5);
    expect(countChars("👍🏻a")).toBe(2);
  });
  it("최대값이 있으면 분수로", () => {
    expect(countLabel(3, 100)).toBe("3/100");
    expect(countLabel(3)).toBe("3자");
  });
});

describe("칩 입력", () => {
  it("쉼표로 나누고 공백·빈 값·중복을 뺀다", () => {
    expect(addTags(["리뷰"], " 언박싱, ,리뷰 ,ASMR")).toEqual(["리뷰", "언박싱", "ASMR"]);
    expect(addTags(["asmr"], "ASMR")).toEqual(["asmr"]);
  });
  it("최대 개수에서 멈춘다", () => {
    expect(addTags(["a"], "b,c,d", 2)).toEqual(["a", "b"]);
  });
});
