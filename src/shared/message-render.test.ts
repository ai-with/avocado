import { describe, expect, it } from "vitest";
import { exampleValues, keysIn, pickBody, renderMessage, templatesUsing, unknownKeys, varKeyProblem } from "./message-render";
import { systemValues, userValues, type ParticipantFacts } from "./message-values";

describe("renderMessage", () => {
  it("값을 채운다", () => {
    const r = renderMessage("{{influencer_name}}님, {{ brand_name }}이에요", { influencer_name: "달밤툰", brand_name: "데모" });
    expect(r.text).toBe("달밤툰님, 데모이에요");
    expect(r.empty).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  it("빈 값과 없는 변수는 {{key}} 를 남기고 목록으로 돌려준다", () => {
    const r = renderMessage("{{fee}} / {{nope}} / {{fee}}", { fee: " " });
    expect(r.text).toBe("{{fee}} / {{nope}} / {{fee}}");
    expect(r.empty).toEqual(["fee"]);
    expect(r.unknown).toEqual(["nope"]);
    expect(r.parts.filter((p) => "key" in p)).toHaveLength(3);
  });

  it("본문의 key 와 정의되지 않은 key 를 찾는다", () => {
    expect(keysIn("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
    expect(unknownKeys("{{brand_name}} {{shipping_note}}", new Set(["brand_name"]))).toEqual(["shipping_note"]);
  });
});

describe("pickBody 언어 대체", () => {
  it("원하는 언어가 있으면 그대로, 비었으면 다른 언어로", () => {
    expect(pickBody({ ko: "안녕", en: "Hi" }, "en")).toEqual({ lang: "en", body: "Hi", fallback: false });
    expect(pickBody({ ko: "안녕", en: "  " }, "en")).toEqual({ lang: "ko", body: "안녕", fallback: true });
    expect(pickBody({}, "ko")).toBeNull();
  });
});

describe("varKeyProblem", () => {
  it("형식·기본 변수·중복을 막는다", () => {
    expect(varKeyProblem("shipping_note", [])).toBeNull();
    expect(varKeyProblem("", [])).not.toBeNull();
    expect(varKeyProblem("Shipping", [])).not.toBeNull();
    expect(varKeyProblem("1abc", [])).not.toBeNull();
    expect(varKeyProblem("a-b", [])).not.toBeNull();
    expect(varKeyProblem("brand_name", [])).toContain("기본 변수");
    expect(varKeyProblem("shipping_note", ["shipping_note"])).toContain("이미");
    expect(varKeyProblem("a".repeat(41), [])).not.toBeNull();
  });
});

describe("templatesUsing", () => {
  it("변수를 쓰는 템플릿 이름만", () => {
    const list = [
      { name: "컨택", bodies: ["{{shipping_note}}", "Hi"] },
      { name: "리마인드", bodies: ["{{deadline}}"] },
    ];
    expect(templatesUsing(list, "shipping_note")).toEqual(["컨택"]);
    expect(templatesUsing(list, "other")).toEqual([]);
  });
});

describe("값 사전", () => {
  const facts: ParticipantFacts = {
    influencerName: "달밤툰",
    igHandle: "dalbam",
    brandName: "데모",
    campaignName: "가을",
    links: { guide: "https://app.test/g/t1", upload: "https://app.test/u/t2", feedback: "https://app.test/f/t3" },
    guideDeadlineAt: Date.UTC(2026, 10, 30, 3),
    contractStartAt: null,
    contractEndAt: null,
    terms: { amount: 500000, currency: "KRW", deliverables: "릴스 1개", memo: "", vars: { shipping_note: "11월 3일 발송" } },
  };

  it("링크에 언어를 붙이고 날짜·금액을 언어 형식으로", () => {
    const ko = systemValues(facts, "ko");
    const en = systemValues(facts, "en");
    expect(ko.guide_link).toBe("https://app.test/g/t1?lang=ko");
    expect(en.upload_link).toBe("https://app.test/u/t2?lang=en");
    expect(ko.ig_handle).toBe("@dalbam");
    expect(ko.fee).toBe("500,000원");
    expect(en.fee).toBe("KRW 500,000");
    expect(ko.deadline).toContain("2026");
    expect(en.deadline).toContain("November");
    expect(ko.contract_end).toBe("");
  });

  it("사용자 변수는 인플루언서별 값이 먼저, 없으면 기본값", () => {
    const vars = [{ key: "shipping_note", defaultValue: "곧 발송" }, { key: "code", defaultValue: "AVO" }];
    expect(userValues(vars, facts.terms?.vars)).toEqual({ shipping_note: "11월 3일 발송", code: "AVO" });
    expect(userValues(vars, undefined)).toEqual({ shipping_note: "곧 발송", code: "AVO" });
  });

  it("미리보기 예시 링크는 앱 주소를 붙인다", () => {
    expect(exampleValues("http://localhost:5173").guide_link).toBe("http://localhost:5173/g/abc?lang=ko");
  });
});
