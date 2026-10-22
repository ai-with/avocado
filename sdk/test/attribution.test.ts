import { beforeEach, describe, expect, it } from "vitest";
import type { AttributionTouch } from "../../src/shared/sdk-events";
import { cleanEventUrl, loadAttribution, mergeTouch, parseTouch, saveTouch, stripTrackingParams } from "../src/attribution";
import { KEY_ATTR } from "../src/config";
import { SdkStorage } from "../src/storage";
import { resetBrowserState } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1);

function touch(clickId: string | null, at: number): AttributionTouch {
  return { clickId, utm: {}, referrerHost: null, landingPath: "/", at };
}

describe("parseTouch", () => {
  it("avc와 utm을 읽고 referrer 호스트를 남긴다", () => {
    const url = new URL("https://shop.test/landing?avc=abc123&utm_source=insta&utm_campaign=g1&x=1");
    expect(parseTouch(url, "https://l.instagram.com/x?y=1", T0)).toEqual({
      clickId: "abc123",
      utm: { source: "insta", campaign: "g1" },
      referrerHost: "l.instagram.com",
      landingPath: "/landing",
      at: T0,
    });
  });

  it("avc·utm이 없는 직접 방문과 내부 이동은 터치가 아니다", () => {
    expect(parseTouch(new URL("https://shop.test/a?x=1"), "https://shop.test/b", T0)).toBeNull();
  });

  it("형식이 틀린 avc는 버린다 (서버가 봉투 전체를 거절하지 않게)", () => {
    expect(parseTouch(new URL(`https://shop.test/?avc=${"a".repeat(41)}`), "", T0)).toBeNull();
    expect(parseTouch(new URL("https://shop.test/?avc=<x>&utm_source=a"), "", T0)?.clickId).toBeNull();
  });

  it("같은 호스트 referrer는 남기지 않는다", () => {
    expect(parseTouch(new URL("https://shop.test/?avc=a"), "https://shop.test/b", T0)?.referrerHost).toBeNull();
  });
});

describe("mergeTouch", () => {
  it("first는 덮지 않고 last만 갱신한다", () => {
    const first = mergeTouch(null, touch("a", T0), T0, 30);
    const merged = mergeTouch(first, touch("b", T0 + DAY), T0 + DAY, 30);
    expect(merged?.first.clickId).toBe("a");
    expect(merged?.last.clickId).toBe("b");
    expect(merged?.expiresAt).toBe(T0 + 31 * DAY);
  });

  it("터치 없는 방문은 last를 덮지 않는다", () => {
    const first = mergeTouch(null, touch("a", T0), T0, 30);
    expect(mergeTouch(first, null, T0 + DAY, 30)).toBe(first);
  });

  it("보관 기간이 지나면 버리고 새 터치가 first가 된다", () => {
    const old = mergeTouch(null, touch("a", T0), T0, 30);
    expect(mergeTouch(old, null, T0 + 31 * DAY, 30)).toBeNull();
    expect(mergeTouch(old, touch("b", T0 + 31 * DAY), T0 + 31 * DAY, 30)?.first.clickId).toBe("b");
  });
});

describe("저장", () => {
  beforeEach(() => resetBrowserState());

  it("granted면 localStorage와 쿠키 _avc에 함께 저장한다", () => {
    const storage = new SdkStorage(null, 30);
    storage.setPersistent(true);
    saveTouch(storage, touch("a", T0), T0, 30);
    expect(JSON.parse(localStorage.getItem(KEY_ATTR) ?? "{}").first.clickId).toBe("a");
    expect(document.cookie).toContain("_avc=");
  });

  it("localStorage가 비어도 쿠키에서 읽는다 (서브도메인 이동)", () => {
    const storage = new SdkStorage(null, 30);
    storage.setPersistent(true);
    saveTouch(storage, touch("a", T0), T0, 30);
    localStorage.removeItem(KEY_ATTR);
    expect(loadAttribution(storage, T0 + DAY)?.first.clickId).toBe("a");
  });

  it("만료된 값은 읽을 때 지운다", () => {
    const storage = new SdkStorage(null, 30);
    storage.setPersistent(true);
    saveTouch(storage, touch("a", T0), T0, 30);
    expect(loadAttribution(storage, T0 + 31 * DAY)).toBeNull();
    expect(localStorage.getItem(KEY_ATTR)).toBeNull();
  });
});

describe("URL 정리", () => {
  it("주소창에서 avc와 avc_optout만 지운다", () => {
    expect(stripTrackingParams("https://s.test/p?avc=a&utm_source=x&avc_optout=1#h")).toBe("https://s.test/p?utm_source=x#h");
    expect(stripTrackingParams("https://s.test/p?q=1")).toBeNull();
  });

  it("이벤트 url은 utm_*·avc만 남기고 해시를 버린다", () => {
    expect(cleanEventUrl("https://s.test/p?token=secret&utm_source=x&avc=a#frag")).toBe("https://s.test/p?utm_source=x&avc=a");
  });
});
