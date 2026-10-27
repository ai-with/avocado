import { describe, expect, it } from "vitest";
import { checkGuidePhoto, defaultSceneKey, GUIDE_PHOTO_MAX_BYTES, langFromSearch, withLangParam } from "./guide-public";

describe("checkGuidePhoto", () => {
  it("jpg·png·webp 이고 5MB 이하면 통과", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp"]) expect(checkGuidePhoto(t, 1000)).toBeNull();
    expect(checkGuidePhoto("image/png", GUIDE_PHOTO_MAX_BYTES)).toBeNull();
  });
  it("다른 형식, 빈 파일, 5MB 초과는 막는다", () => {
    expect(checkGuidePhoto("image/gif", 1000)).toBe("bad_type");
    expect(checkGuidePhoto("application/pdf", 1000)).toBe("bad_type");
    expect(checkGuidePhoto("image/png", 0)).toBe("empty");
    expect(checkGuidePhoto("image/png", GUIDE_PHOTO_MAX_BYTES + 1)).toBe("too_large");
  });
});

describe("defaultSceneKey", () => {
  it("기본 제목이나 영어 키면 번역 대상", () => {
    expect(defaultSceneKey({ key: "hook", title: "0~3초 훅" })).toBe("hook");
    expect(defaultSceneKey({ key: "usage", title: "Usage" })).toBe("usage");
  });
  it("브랜드가 쓴 제목은 그대로 둔다", () => {
    expect(defaultSceneKey({ key: "hook", title: "첫 장면: 세럼 한 방울" })).toBeNull();
  });
});

describe("withLangParam / langFromSearch", () => {
  it("lang 을 붙이고, 이미 있으면 바꾼다", () => {
    expect(withLangParam("https://a.test/g/abc", "en")).toBe("https://a.test/g/abc?lang=en");
    expect(withLangParam("https://a.test/g/abc?lang=en&x=1", "ko")).toBe("https://a.test/g/abc?lang=ko&x=1");
    expect(withLangParam("/g/abc#top", "en")).toBe("/g/abc?lang=en#top");
  });
  it("지원 언어만 읽는다", () => {
    expect(langFromSearch("?lang=en")).toBe("en");
    expect(langFromSearch("?lang=jp")).toBeNull();
    expect(langFromSearch("")).toBeNull();
  });
});
