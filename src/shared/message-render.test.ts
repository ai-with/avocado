import { describe, expect, it } from "vitest";
import { exampleValues, keysIn, pickBody, renderMessage, templatesUsing, unknownKeys, varKeyProblem } from "./message-render";
import { systemValues, userValues, type ParticipantFacts } from "./message-values";

describe("renderMessage", () => {
  it("값을 채운다", () => {
    const r = renderMessage("{{influencer_name}}님, {{ brand_name }}이에요", { influencer_name: "달밤툰", brand_name: "데모" });
    expect(r.text).toBe("달밤툰님, 데모예요");
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

describe("renderMessage 조사 교정 (AIWITH-567)", () => {
  const v = { a: "크림", b: "토너", c: "서울", e: "", n: "3", h: "@dalbam_toon", f: "500,000원", en: "Notion" };
  const r = (body: string, values: Record<string, string> = v) => renderMessage(body, values).text;

  it("시드 문장: 데모 브랜드예요", () => {
    const ko = "안녕하세요 {{influencer_name}}님, {{brand_name}}이에요.\n{{campaign_name}} 캠페인에 함께하고 싶어 연락드려요.";
    expect(r(ko, exampleValues("https://x.test"))).toBe("안녕하세요 달밤툰님, 데모 브랜드예요.\n가을 신제품 캠페인 캠페인에 함께하고 싶어 연락드려요.");
  });
  it("이에요/예요 어느 쪽으로 써도 맞춘다", () => {
    expect(r("{{a}}이에요 {{b}}예요 {{c}}예요 {{a}}예요")).toBe("크림이에요 토너예요 서울이에요 크림이에요");
  });
  it("어미 포함형: 이었/였, 이라고/라고 는 허용 어미가 이어져도 고친다", () => {
    expect(r("{{b}}이었어요 {{a}}였어요")).toBe("토너였어요 크림이었어요");
    expect(r("{{b}}이라고요 {{a}}라고 {{a}}라고도")).toBe("토너라고요 크림이라고 크림이라고도");
    expect(r("{{b}}이었던 {{b}}이었다.")).toBe("토너였던 토너였다.");
    expect(r("{{b}}이었 {{a}}였")).toBe("토너였 크림이었");
  });
  it("이야/야, 이랑/랑, 이나/나, 호격", () => {
    expect(r("{{b}}이야? {{a}}이야? {{a}}야? {{a}}야. {{b}}야?")).toBe("토너야? 크림이야? 크림이야? 크림이야. 토너야?");
    expect(r("주인공은 {{a}}야!")).toBe("주인공은 크림야!");
    expect(r("{{b}}이랑 {{a}}랑 {{b}}이나 {{a}}나")).toBe("토너랑 크림이랑 토너나 크림이나");
    expect(r("{{b}}아 {{a}}아 {{b}}야")).toBe("토너야 크림아 토너야");
  });
  it("으로서/로서, 으로써/로써, 으로/로: ㄹ 받침은 로", () => {
    expect(r("{{a}}로서 {{c}}으로서 {{b}}으로써 {{a}}로써 {{c}}으로 {{a}}로 {{b}}으로")).toBe("크림으로서 서울로서 토너로써 크림으로써 서울로 크림으로 토너로");
    expect(r("{{a}}로부터 {{c}}으로는")).toBe("크림으로부터 서울로는");
  });
  it("이/가, 을/를, 은/는, 과/와", () => {
    expect(r("{{a}}가 {{b}}이 {{a}}를 {{b}}을 {{a}}는 {{b}}은 {{a}}와 {{b}}과")).toBe("크림이 토너가 크림을 토너를 크림은 토너는 크림과 토너와");
    expect(r("{{c}}이 {{c}}을 {{c}}가 {{c}}와")).toBe("서울이 서울을 서울이 서울과");
  });
  it("병기형은 맞는 쪽 하나로", () => {
    expect(r("{{a}}을/를 {{b}}을/를 {{a}}이/가 {{b}}은/는 {{a}}과/와")).toBe("크림을 토너를 크림이 토너는 크림과");
    expect(r("{{a}}(이)에요 {{b}}(이)에요 {{b}}(으)로 {{a}}(으)로 {{c}}(으)로")).toBe("크림이에요 토너예요 토너로 크림으로 서울로");
    expect(r("{{b}}(이)랑 {{b}}(이)나 {{b}}(이)라고 {{b}}(이)야 {{b}}(으)로서 {{a}}(으)로써")).toBe("토너랑 토너나 토너라고 토너야 토너로서 크림으로써");
    expect(r("{{a}}을/를위해")).toBe("크림을위해");
  });
  it("경계가 아니면 그대로 둔다", () => {
    expect(r("{{b}}이번 주 {{a}}가방 {{b}}은행 {{a}}이야기 {{a}}나라 {{a}}로고 {{b}}와인 {{b}}아침")).toBe("토너이번 주 크림가방 토너은행 크림이야기 크림나라 크림로고 토너와인 토너아침");
  });
  it("경계: 한글·영문·숫자가 아니면 모두 경계", () => {
    expect(r("{{a}}예요^^ {{a}}예요😊 {{a}}가ㅎㅎ {{a}}예요(웃음) {{a}}가-{{b}} {{a}}는/{{b}} {{a}}가。")).toBe("크림이에요^^ 크림이에요😊 크림이ㅎㅎ 크림이에요(웃음) 크림이-토너 크림은/토너 크림이。");
  });
  it("오기 에요도 고친다", () => {
    expect(r("{{a}}에요 {{b}}에요 {{a}}이에요 {{b}}이에요 {{a}}에요.")).toBe("크림이에요 토너예요 크림이에요 토너예요 크림이에요.");
    expect(r("{{a}}에요일")).toBe("크림에요일");
  });
  it("공백이 있으면 변수 바로 뒤가 아니므로 그대로 둔다", () => {
    expect(r("{{a}} 이에요 {{b}} 가")).toBe("크림 이에요 토너 가");
  });
  it("빈 값·없는 변수는 조사를 건드리지 않는다", () => {
    expect(r("{{e}}이에요 {{nope}}가 {{e}}를", { e: " " })).toBe("{{e}}이에요 {{nope}}가 {{e}}를");
  });
  it("숫자·영문·핸들·금액 값", () => {
    // 병기형은 받침 추정으로 고른다
    expect(r("{{n}}(이)에요 {{n}}을/를 {{h}}이/가 {{h}}을/를 {{f}}(이)에요 {{f}}를 {{en}}이/가 {{en}}(으)로")).toBe("3이에요 3을 @dalbam_toon이 @dalbam_toon을 500,000원이에요 500,000원을 Notion이 Notion으로");
  });
  it("값이 한글로 끝나지 않으면 단독형 조사는 작성자 표기 그대로", () => {
    const w = { g: "Google", d: "Dior", l: "LINE", ap: "Apple", sk: "SK", kt: "KT", p: "100%", cm: "30cm", n: "3", h: "@dalbam_toon" };
    expect(r("{{g}}이 {{d}}은 {{l}}으로 {{ap}}이에요 {{sk}}가 {{kt}}를 {{p}}예요 {{cm}}예요", w)).toBe("Google이 Dior은 LINE으로 Apple이에요 SK가 KT를 100%예요 30cm예요");
    expect(r("종로{{n}}가 {{h}}가 {{n}}이에요", w)).toBe("종로3가 @dalbam_toon가 3이에요");
    expect(r("{{a}}가", { a: "크림)" })).toBe("크림)이");
  });
  it("연속 토큰과 토큰 앞 경계", () => {
    expect(r("{{a}}{{b}}이에요")).toBe("크림토너예요");
    expect(r("{{a}}가{{b}}")).toBe("크림이토너");
    expect(r("{{a}}{{b}}")).toBe("크림토너");
  });
  it("parts 와 text 가 일치하고 변수 part 는 그대로다", () => {
    const res = renderMessage("{{a}}이에요, {{c}}을/를 {{nope}}가", v);
    expect(res.text).toBe("크림이에요, 서울을 {{nope}}가");
    expect(res.parts.map((p) => ("key" in p ? p.value : p.text)).join("")).toBe(res.text);
    expect(res.parts.filter((p) => "key" in p)).toEqual([
      { key: "a", value: "크림", state: "ok" },
      { key: "c", value: "서울", state: "ok" },
      { key: "nope", value: "{{nope}}", state: "unknown" },
    ]);
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
