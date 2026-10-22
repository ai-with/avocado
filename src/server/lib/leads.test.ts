import { describe, expect, it } from "vitest";
import { evaluateGroup, type LeadFacts } from "./lead-groups";
import { appendUtm, buildUtm, deviceOf, hasUtm, isBotUA, newSlug } from "./links";
import { isBlockedEmail, isFreeEmail } from "../../shared/leads";
import { parseCsv, toCsv } from "../../shared/csv";

const lead = (over: Partial<LeadFacts> = {}): LeadFacts => ({
  marketingOptIn: true,
  alimtalkOptIn: false,
  createdAt: 1000,
  tagIds: ["t1"],
  sources: [
    { type: "gate", guideId: "g1", influencerId: "A", channelKey: "ig_bio" },
    { type: "form", guideId: "g1", influencerId: "B", channelKey: "threads" },
  ],
  ...over,
});

describe("evaluateGroup", () => {
  it("조건이 없으면 전원", () => expect(evaluateGroup({ all: [] }, lead())).toBe(true));
  it("인플루언서 A 유입 + 마케팅 동의", () => {
    const rules = { all: [{ field: "influencer_id", op: "eq", value: "A" }, { field: "marketing_opt_in", op: "eq", value: true }] } as const;
    expect(evaluateGroup({ all: [...rules.all] }, lead())).toBe(true);
    expect(evaluateGroup({ all: [...rules.all] }, lead({ marketingOptIn: false }))).toBe(false);
  });
  it("출처 중 하나라도 맞으면 eq, 하나도 없어야 neq", () => {
    expect(evaluateGroup({ all: [{ field: "channel_key", op: "eq", value: "threads" }] }, lead())).toBe(true);
    expect(evaluateGroup({ all: [{ field: "source_type", op: "neq", value: "import" }] }, lead())).toBe(true);
    expect(evaluateGroup({ all: [{ field: "source_type", op: "neq", value: "gate" }] }, lead())).toBe(false);
  });
  it("태그, 가입 시점, 문자열 boolean", () => {
    expect(evaluateGroup({ all: [{ field: "tag_id", op: "eq", value: "t1" }] }, lead())).toBe(true);
    expect(evaluateGroup({ all: [{ field: "created_after", op: "eq", value: 2000 }] }, lead())).toBe(false);
    expect(evaluateGroup({ all: [{ field: "alimtalk_opt_in", op: "eq", value: "false" }] }, lead())).toBe(true);
  });
});

describe("UTM", () => {
  it("채널 플랫폼과 인플루언서 핸들로 채운다", () => {
    expect(buildUtm("ig_story", "spring-launch", "jay")).toEqual({ source: "instagram", medium: "influencer", campaign: "spring-launch", content: "jay", term: "ig_story" });
    expect(buildUtm("custom:abc", "g", null)).toMatchObject({ source: "custom", content: "shared", term: "custom:abc" });
  });
  it("목적지에 붙이고 기존 utm 은 덮어쓴다", () => {
    const url = appendUtm("https://ex.com/p?utm_source=old&x=1", buildUtm("threads", "g", "h"));
    const u = new URL(url);
    expect(u.searchParams.get("utm_source")).toBe("threads");
    expect(u.searchParams.get("x")).toBe("1");
    expect(hasUtm("https://ex.com/?utm_medium=a")).toBe(true);
    expect(hasUtm("https://ex.com/?a=1")).toBe(false);
  });
  it("slug 는 7자 base62", () => expect(newSlug()).toMatch(/^[0-9A-Za-z]{7}$/));
});

describe("봇·기기 판정", () => {
  it.each([
    "facebookexternalhit/1.1",
    "Mozilla/5.0 (compatible; Googlebot/2.1)",
    "Slackbot-LinkExpanding 1.0",
    "WhatsApp/2.23",
    "Twitterbot/1.0",
    "kakaotalk-scrap/1.0",
    undefined,
  ])("%s 는 봇", (ua) => expect(isBotUA(ua)).toBe(true));
  it("일반 브라우저는 봇이 아니다", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0";
    expect(isBotUA(iphone)).toBe(false);
    expect(deviceOf(iphone)).toBe("mobile");
    expect(deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("desktop");
  });
});

describe("회사 이메일·차단 목록", () => {
  it("무료 메일은 회사 이메일이 아니다", () => {
    for (const e of ["a@gmail.com", "a@naver.com", "a@daum.net", "a@yahoo.co.kr", "a@hotmail.com", "a@outlook.com", "a@icloud.com", "a@kakao.com"]) expect(isFreeEmail(e)).toBe(true);
    expect(isFreeEmail("kim@acme.co.kr")).toBe(false);
  });
  it("전체 이메일 또는 도메인으로 막는다", () => {
    expect(isBlockedEmail("x@rival.com", ["@rival.com"])).toBe(true);
    expect(isBlockedEmail("x@rival.com", ["rival.com"])).toBe(true);
    expect(isBlockedEmail("x@rival.com", ["y@rival.com"])).toBe(false);
    expect(isBlockedEmail("Y@Rival.com", ["y@rival.com"])).toBe(true);
  });
});

describe("CSV", () => {
  it("따옴표·쉼표·줄바꿈을 왕복한다", () => {
    const rows = [["email", "name"], ["a@b.com", 'Kim, "J"\nPark']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
