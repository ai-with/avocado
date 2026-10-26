import { describe, expect, it } from "vitest";
import { contentBuckets, contentUtm, nextContentKey } from "./link-content";
import { buildUtm, takenBaseCells } from "./links";

describe("콘텐츠별 링크 utm_content", () => {
  it("기본 링크 UTM 을 그대로 쓰고 content 만 <핸들>_<키>", () => {
    const base = buildUtm("ig_reels", "spring-launch", "jay");
    expect(contentUtm(base, "c2")).toEqual({ ...base, content: "jay_c2" });
    expect(base.content).toBe("jay");
  });
  it("키는 c2 부터, 지운 키도 다시 쓰지 않고 가장 큰 번호 다음", () => {
    expect(nextContentKey([])).toBe("c2");
    expect(nextContentKey(["c2", "c3"])).toBe("c4");
    expect(nextContentKey(["c5", null, "x"])).toBe("c6");
  });
});

describe("기본 링크 유일성", () => {
  it("콘텐츠 링크만 있는 칸은 비어 있는 칸으로 본다", () => {
    const taken = takenBaseCells([
      { influencerId: "A", channelKey: "ig_bio", contentKey: null },
      { influencerId: "A", channelKey: "ig_reels", contentKey: "c2" },
      { influencerId: null, channelKey: "ig_bio", contentKey: null },
    ]);
    expect(taken.has("A|ig_bio")).toBe(true);
    expect(taken.has("A|ig_reels")).toBe(false);
    expect(taken.has("|ig_bio")).toBe(true);
  });
});

describe("콘텐츠별 분석 묶음", () => {
  it("묶음 1개: 콘텐츠 미지정은 기본 링크", () => {
    expect(contentBuckets([{ key: "", clicks: 3, unique: 2 }])).toEqual([{ key: "", clicks: 3, unique: 2, name: "기본 링크" }]);
  });
  it("묶음 3개: 이름은 그대로, 순서 유지", () => {
    const rows = [{ key: "두 번째 릴스", clicks: 5 }, { key: "", clicks: 3 }, { key: "라이브", clicks: 1 }];
    expect(contentBuckets(rows).map((r) => r.name)).toEqual(["두 번째 릴스", "기본 링크", "라이브"]);
  });
});
