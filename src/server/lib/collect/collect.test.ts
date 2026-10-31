import { describe, expect, it } from "vitest";
import type { Envelope, SdkEvent } from "../../../shared/sdk-events";
import { MAX_EVENTS, parseEnvelope } from "./schema";
import { appendClickId, hostAllowed, normalizeDomain } from "./origin";
import { dailyDelta, kstDay, newScrollSteps, sessionDelta } from "./aggregate";
import { shouldDrop } from "../../routes/collect";
import { snippetOf } from "../../routes/sites/shared";

const base = { url: "https://shop.example.com/p", ref: null };
const ev = (id: string, rest: Record<string, unknown>) => ({ id, ts: 1_000, ...base, ...rest });
const envelope = (events: unknown[], extra: Record<string, unknown> = {}) => ({
  v: 1,
  sdk: "1.0.0",
  site: "site_abc",
  anon: "anon_12345678",
  sess: "sess_12345678",
  consent: "granted",
  attr: { first: null, last: { clickId: "tok_1234567890ab", utm: { source: "instagram" }, referrerHost: null, landingPath: "/", at: 900 } },
  screen: { w: 390, h: 844, dpr: 3 },
  sentAt: 2_000,
  events,
  ...extra,
});
const parse = (o: unknown) => parseEnvelope(JSON.stringify(o));

describe("봉투 zod 스키마", () => {
  it("정상 봉투를 받고 모르는 t 와 형식이 틀린 이벤트만 버린다", () => {
    const env = parse(envelope([ev("evt_000001", { t: "pageview", title: "홈" }), ev("evt_000002", { t: "heatmap" }), ev("evt_000003", { t: "scroll", depth: 33 })]));
    expect(env?.events.map((e) => e.t)).toEqual(["pageview"]);
  });
  it("이벤트 50개 초과분은 버린다", () => {
    const many = Array.from({ length: MAX_EVENTS + 5 }, (_, i) => ev(`evt_${String(i).padStart(6, "0")}`, { t: "dwell", ms: 10 }));
    expect(parse(envelope(many))?.events).toHaveLength(MAX_EVENTS);
  });
  it("track props 는 20개, 문자열 200자로 자르고 통화는 대문자로", () => {
    const props = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, "x".repeat(300)]));
    const env = parse(envelope([ev("evt_000001", { t: "track", name: "plan", props }), ev("evt_000002", { t: "conversion", kind: "purchase", value: 39000, currency: "krw" })]));
    const [track, conv] = env?.events ?? [];
    expect(track?.t === "track" && Object.keys(track.props)).toHaveLength(20);
    expect(track?.t === "track" && String(track.props.k0).length).toBe(200);
    expect(conv?.t === "conversion" && conv.currency).toBe("KRW");
  });
  it("버전·JSON·필수 필드가 틀리면 null", () => {
    expect(parse(envelope([], { v: 2 }))).toBeNull();
    expect(parseEnvelope("{not json")).toBeNull();
    expect(parse({ ...envelope([]), sess: undefined })).toBeNull();
  });
});

describe("허용 도메인 매칭", () => {
  it("입력 정규화", () => {
    expect(normalizeDomain("https://WWW.Example.com/path")).toBe("www.example.com");
    expect(normalizeDomain("*.example.com")).toBe("*.example.com");
    expect(normalizeDomain("not a domain")).toBeNull();
  });
  it("와일드카드는 apex 와 하위 도메인, 일반은 정확히 같은 호스트만. 포트·대소문자 무시", () => {
    expect(hostAllowed("shop.example.com", ["*.example.com"])).toBe(true);
    expect(hostAllowed("example.com", ["*.example.com"])).toBe(true);
    expect(hostAllowed("badexample.com", ["*.example.com"])).toBe(false);
    expect(hostAllowed("WWW.example.com:8443", ["www.example.com"])).toBe(true);
    expect(hostAllowed("example.com", ["www.example.com"])).toBe(false);
  });
});

describe("클릭 ID 부착 조건", () => {
  it("등록 사이트 도메인일 때만 avc 를 붙이고 기존 쿼리는 둔다", () => {
    expect(appendClickId("https://shop.example.com/a?utm_source=x", "tok", ["*.example.com"])).toBe("https://shop.example.com/a?utm_source=x&avc=tok");
    expect(appendClickId("https://other.com/a", "tok", ["*.example.com"])).toBe("https://other.com/a");
    expect(appendClickId("https://shop.example.com/a", null, ["*.example.com"])).toBe("https://shop.example.com/a");
    expect(appendClickId("https://shop.example.com/a", "tok", [])).toBe("https://shop.example.com/a");
  });
});

describe("봇·동의 판정", () => {
  const chrome = "Mozilla/5.0 (Macintosh) Chrome/130";
  const env = (extra: Partial<Envelope>) => ({ ...(envelope([]) as unknown as Envelope), ...extra });
  it("봇 UA, webdriver 표시, 거부는 버린다", () => {
    expect(shouldDrop(env({}), { consentMode: "auto" }, "Googlebot/2.1")).toBe(true);
    expect(shouldDrop(env({ bot: true }), { consentMode: "auto" }, chrome)).toBe(true);
    expect(shouldDrop(env({ consent: "denied" }), { consentMode: "auto" }, chrome)).toBe(true);
  });
  it("동의 필요 사이트는 granted 만, auto 는 pending 도 받는다", () => {
    expect(shouldDrop(env({ consent: "pending" }), { consentMode: "require" }, chrome)).toBe(true);
    expect(shouldDrop(env({ consent: "pending" }), { consentMode: "auto" }, chrome)).toBe(false);
    expect(shouldDrop(env({}), { consentMode: "require" }, chrome)).toBe(false);
  });
});

describe("세션 집계", () => {
  const events: SdkEvent[] = [
    { id: "e1", ts: 1_000, ...base, t: "pageview", title: "홈" },
    { id: "e2", ts: 1_100, ...base, t: "scroll", depth: 50 },
    { id: "e3", ts: 1_200, ...base, t: "click", sel: "a", text: "구매", href: null, x: 0.1, y: 0.2, vw: "m" },
    { id: "e4", ts: 1_300, ...base, t: "dwell", ms: 4_000 },
    { id: "e5", ts: 1_400, ...base, t: "conversion", kind: "purchase", value: 39_000, orderId: "A-1" },
  ];
  const env = { ...(envelope([]) as unknown as Envelope), events };
  it("봉투를 세션 증분으로 줄이고 시계 차이를 보정한다", () => {
    const d = sessionDelta(env, 3_000, new Set());
    expect(d).toMatchObject({ pageviews: 1, maxScroll: 50, clicks: 1, visibleMs: 4_000, firstAt: 2_000, lastAt: 2_400 });
    expect(d?.conversions).toHaveLength(1);
  });
  it("이미 본 이벤트는 빼고 전부 봤으면 null", () => {
    expect(sessionDelta(env, 3_000, new Set(["e1"]))?.pageviews).toBe(0);
    expect(sessionDelta(env, 3_000, new Set(events.map((e) => e.id)))).toBeNull();
  });
  it("스크롤 단계는 새로 넘은 것만", () => {
    expect(newScrollSteps(0, 75)).toEqual([25, 50, 75]);
    expect(newScrollSteps(50, 100)).toEqual([75, 100]);
    expect(newScrollSteps(75, 50)).toEqual([]);
  });
  it("일별 증분: 새 세션 1, 구성원 세션은 제외 수만, 다른 통화 금액은 빼고 센다", () => {
    const d = sessionDelta(env, 3_000, new Set())!;
    const usd = { ...d.conversions[0]!, currency: "USD" };
    expect(dailyDelta(d, d.conversions, null, false, "KRW")).toEqual({ sessions: 1, pageviews: 1, scroll: [25, 50], conversions: 1, conversionValue: 39_000, membersExcluded: 0 });
    expect(dailyDelta(d, [{ ...d.conversions[0]!, value: 1e308 }, { ...d.conversions[0]!, value: 1e308 }], null, false, "KRW").conversionValue).toBe(0);
    expect(dailyDelta(d, [usd], 50, false, "KRW")).toMatchObject({ sessions: 0, scroll: [], conversions: 1, conversionValue: 0 });
    expect(dailyDelta(d, d.conversions, null, true, "KRW")).toEqual({ sessions: 0, pageviews: 0, scroll: [], conversions: 0, conversionValue: 0, membersExcluded: 1 });
  });
  it("일자는 한국 시간", () => {
    expect(kstDay(Date.UTC(2026, 9, 22, 15, 30))).toBe("2026-10-23");
  });
});

describe("설치 스니펫", () => {
  it("동의 필요 사이트는 동의 전 전송을 막는 require 로 설치된다", () => {
    expect(snippetOf({ siteKey: "site_a", consentMode: "require" }, "https://app.test")).toContain('data-consent="require"');
    expect(snippetOf({ siteKey: "site_a", consentMode: "auto" }, "https://app.test")).not.toContain("data-consent");
  });
});
