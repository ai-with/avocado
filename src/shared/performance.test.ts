import { describe, expect, it } from "vitest";
import { HOUR, MINUTE, afterApiError, delayInfo, matchKeyword, parsePostUrl, planSnapshots, renderDm } from "./performance";

describe("스냅샷 예약", () => {
  const posted = Date.UTC(2026, 9, 1, 0, 0);
  it("게시 직후 등록이면 3건 모두 예약", () => {
    const p = planSnapshots(posted, posted + 10 * MINUTE);
    expect(p.map((s) => [s.offsetH, s.status])).toEqual([[24, "scheduled"], [72, "scheduled"], [168, "scheduled"]]);
    expect(p[0]?.scheduledAt).toBe(posted + 24 * HOUR);
    expect(p[2]?.scheduledAt).toBe(posted + 168 * HOUR);
  });
  it("24시간 지나 등록하면 24시간만 registered_late", () => {
    const p = planSnapshots(posted, posted + 30 * HOUR);
    expect(p.map((s) => s.status)).toEqual(["missing", "scheduled", "scheduled"]);
    expect(p[0]?.reason).toBe("registered_late");
  });
  it("허용 오차(30분) 안이면 아직 예약", () => {
    expect(planSnapshots(posted, posted + 24 * HOUR + 20 * MINUTE)[0]?.status).toBe("scheduled");
  });
});

describe("지연 판정", () => {
  it("30분 이내는 정시, 넘으면 지연", () => {
    expect(delayInfo(0, 30 * MINUTE)).toEqual({ delayed: false, delayMin: 30 });
    expect(delayInfo(0, 31 * MINUTE)).toEqual({ delayed: true, delayMin: 31 });
  });
});

describe("재시도 규칙", () => {
  it("첫 시도 + 4회 재시도 뒤 결측", () => {
    expect([1, 2, 3, 4, 5].map(afterApiError)).toEqual(["retry", "retry", "retry", "retry", "missing"]);
  });
});

describe("shortcode 추출", () => {
  it("릴스, 피드, 계정명 포함, 쿼리", () => {
    expect(parsePostUrl("https://www.instagram.com/reel/C9xYz_1-ab/?igsh=abc")).toEqual({ shortcode: "C9xYz_1-ab", format: "reel" });
    expect(parsePostUrl("https://instagram.com/p/ABC123/")).toEqual({ shortcode: "ABC123", format: "feed" });
    expect(parsePostUrl("https://www.instagram.com/some.user/reel/XYZ/")).toEqual({ shortcode: "XYZ", format: "reel" });
    expect(parsePostUrl("https://example.com/p/ABC")).toBeNull();
  });
});

describe("키워드 매칭", () => {
  it("대소문자·공백 무시", () => {
    expect(matchKeyword("자 료 주세요!", ["자료"])).toBe("자료");
    expect(matchKeyword("Send me the GUIDE", ["guide"])).toBe("guide");
    expect(matchKeyword("좋아요", ["자료", " "])).toBeNull();
  });
  it("DM 문구에 링크와 꼬리말", () => {
    expect(renderDm("여기 {link}", "https://s/x", "브랜드")).toBe("여기 https://s/x\n\n브랜드 · 더 받지 않으려면 답장으로 알려 주세요");
  });
});
