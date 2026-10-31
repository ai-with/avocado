import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boot } from "../src/boot";
import { canSend, initialConsent } from "../src/consent";
import { KEY_ATTR, KEY_ID, KEY_OPT_OUT } from "../src/config";
import { AvocadoSdk } from "../src/sdk";
import { makeConfig, resetBrowserState, sentEvents, stubFetch } from "./helpers";

let sdk: AvocadoSdk | null = null;

// happy-dom은 문서 높이가 0이라 첫 확인에서 스크롤 100%가 잡힌다. 스크롤은 scroll.test.ts에서 따로 본다
function nonScroll(envelopes: Parameters<typeof sentEvents>[0]) {
  return sentEvents(envelopes).filter((e) => e.t !== "scroll");
}

beforeEach(() => resetBrowserState("/landing?avc=click123&utm_source=insta"));
afterEach(() => {
  sdk?.destroy();
  sdk = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete window.avocado;
});

function start(overrides: Parameters<typeof makeConfig>[0] = {}): AvocadoSdk {
  sdk = new AvocadoSdk(makeConfig(overrides));
  sdk.start();
  return sdk;
}

describe("동의 상태 판정", () => {
  it("DNT·GPC·optOut이면 denied로 시작한다", () => {
    expect(initialConsent(null, { doNotTrack: "1" }, false).state).toBe("denied");
    expect(initialConsent(null, { globalPrivacyControl: true }, false).state).toBe("denied");
    expect(initialConsent("granted", {}, true).state).toBe("denied");
    expect(initialConsent(null, {}, false).state).toBe("granted");
  });

  it("require 모드 pending은 보내지 않고, auto 모드 pending은 메모리 모드로 보낸다", () => {
    expect(canSend(initialConsent("require", {}, false))).toBe(false);
    expect(canSend(initialConsent("pending", {}, false))).toBe(true);
  });
});

describe("동의 모드별 저장", () => {
  it("granted: 저장소에 익명 ID와 어트리뷰션을 쓰고 주소창에서 avc를 지운다", () => {
    const { envelopes } = stubFetch();
    start();
    expect(localStorage.getItem(KEY_ID)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(KEY_ATTR) ?? "{}").last.clickId).toBe("click123");
    expect(location.search).toBe("?utm_source=insta");
    expect(envelopes[0]?.attr.first?.clickId).toBe("click123");
    expect(envelopes[0]?.events[0]?.t).toBe("pageview");
  });

  it("pending: 보내되 디스크에 아무것도 쓰지 않고, granted가 되면 옮긴다", () => {
    const { envelopes } = stubFetch();
    const instance = start({ consent: "pending" });
    expect(envelopes[0]?.consent).toBe("pending");
    expect(localStorage.length).toBe(0);
    expect(document.cookie).not.toMatch(/_avc=[^;]/);
    instance.consent("granted");
    expect(localStorage.getItem(KEY_ATTR)).not.toBeNull();
    expect(localStorage.getItem(KEY_ID)).not.toBeNull();
  });

  it("pending에서는 identify를 보내지 않는다", async () => {
    const { envelopes } = stubFetch();
    await start({ consent: "pending" }).identify({ email: "a@b.com" });
    expect(sentEvents(envelopes).some((e) => e.t === "identify")).toBe(false);
  });

  it("require: 동의 전에는 아무것도 보내지 않는다", () => {
    const { fetchMock } = stubFetch();
    start({ consent: "require" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denied·optOut: 디스크 값을 지우고 이후 수집하지 않는다", () => {
    const { fetchMock } = stubFetch();
    const instance = start();
    fetchMock.mockClear();
    instance.optOut();
    expect(localStorage.getItem(KEY_ID)).toBeNull();
    expect(localStorage.getItem(KEY_ATTR)).toBeNull();
    expect(localStorage.getItem(KEY_OPT_OUT)).toBe("1");
    instance.conversion({ type: "purchase", value: 1000 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("명령", () => {
  it("identify는 기본으로 이메일 SHA-256 해시만 보낸다", async () => {
    const { envelopes } = stubFetch();
    await start().identify({ email: " A@B.com " });
    const identify = sentEvents(envelopes).find((e) => e.t === "identify");
    expect(identify).toMatchObject({ emailHash: "fb98d44ad7501a959f3f4f4a3f004fe2d9e581ea6207e218c4b02c08a4d75adf" });
    expect(JSON.stringify(envelopes)).not.toContain("a@b.com");
  });

  it("conversion은 바로 보내고 통화를 대문자로 맞춘다", () => {
    const { envelopes } = stubFetch();
    start().conversion({ type: "purchase", value: 39000, currency: "krw", orderId: "A-1029" });
    expect(sentEvents(envelopes).find((e) => e.t === "conversion")).toMatchObject({
      kind: "purchase",
      value: 39000,
      currency: "KRW",
      orderId: "A-1029",
    });
  });

  it("스텁 큐의 명령을 순서대로 처리하고 window.avocado를 바꾼다", async () => {
    vi.useFakeTimers();
    const { envelopes } = stubFetch();
    const stub = Object.assign((...args: unknown[]) => stub.q.push(args), { q: [] as unknown[][] });
    window.avocado = stub;
    window.avocado("track", "early", { plan: "pro" });
    const script = document.createElement("script");
    script.dataset.site = "site_abc";
    sdk = await boot(window, script);
    expect(window.avocado.loaded).toBe(true);
    vi.advanceTimersByTime(5_000);
    const names = nonScroll(envelopes).map((e) => e.t);
    expect(names).toEqual(["pageview", "track"]);
    expect(envelopes[0]?.site).toBe("site_abc");
  });
});

describe("SPA 경로 변경", () => {
  it("pushState로 경로가 바뀌면 이전 페이지 체류를 먼저 보내고 페이지뷰", () => {
    vi.useFakeTimers();
    const { envelopes } = stubFetch();
    start();
    vi.advanceTimersByTime(3_000);
    history.pushState(null, "", "/pricing");
    history.replaceState(null, "", "/pricing"); // 같은 경로는 무시
    history.pushState(null, "", "/pricing#faq"); // 해시만 바뀐 것도 무시
    vi.advanceTimersByTime(5_000);
    const events = nonScroll(envelopes);
    expect(events.map((e) => e.t)).toEqual(["pageview", "dwell", "pageview"]);
    expect(events[1]).toMatchObject({ t: "dwell", ms: 3_000 });
    expect(events[1]?.url).toBe("http://localhost:3000/landing?utm_source=insta");
    expect(events[2]?.url).toBe("http://localhost:3000/pricing");
    expect(events[2]?.ref).toBe("http://localhost:3000/landing?utm_source=insta");
  });

  it("popstate도 감지한다", () => {
    vi.useFakeTimers();
    const { envelopes } = stubFetch();
    start();
    history.replaceState(null, "", "/a");
    window.dispatchEvent(new PopStateEvent("popstate"));
    vi.advanceTimersByTime(5_000);
    expect(sentEvents(envelopes).filter((e) => e.t === "pageview")).toHaveLength(2);
  });
});
