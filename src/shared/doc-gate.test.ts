import { describe, expect, it } from "vitest";
import { gateScrollTop, normalizeGate, visiblePct, type LegacyDocumentGate } from "./doc-gate";
import { sanitizeHtml } from "./sanitize";
import { DEFAULT_GATE } from "./leads";

const { position: _p, scrollPct: _s, ...rest } = DEFAULT_GATE;
const legacy = (position: LegacyDocumentGate["position"], page: number): LegacyDocumentGate => ({ ...rest, position, page });

describe("normalizeGate", () => {
  it("before 는 0%, after_page 는 쪽수 비율", () => {
    expect(normalizeGate(legacy("before", 3), 10)).toMatchObject({ position: "scroll", scrollPct: 0 });
    expect(normalizeGate(legacy("after_page", 3), 10)).toMatchObject({ position: "scroll", scrollPct: 30 });
    expect(normalizeGate(legacy("after_page", 20), 10).scrollPct).toBe(100);
    expect(normalizeGate(legacy("after_page", 3), 10)).not.toHaveProperty("page");
  });
  it("새 형식과 none 은 그대로, 범위만 자른다", () => {
    expect(normalizeGate({ ...DEFAULT_GATE, position: "scroll", scrollPct: 140 }, 1).scrollPct).toBe(100);
    expect(normalizeGate(DEFAULT_GATE, 1)).toEqual(DEFAULT_GATE);
  });
});

describe("visiblePct, gateScrollTop", () => {
  it("보인 최하단 기준", () => {
    expect(visiblePct(0, 500, 2000)).toBe(25);
    expect(visiblePct(1500, 500, 2000)).toBe(100);
    expect(visiblePct(0, 800, 600)).toBe(100);
  });
  it("게이트 위치에서 최하단이 정확히 비율에 닿는다", () => {
    const top = gateScrollTop(50, 500, 2000);
    expect(top).toBe(500);
    expect(visiblePct(top, 500, 2000)).toBe(50);
    expect(gateScrollTop(10, 500, 2000)).toBe(0);
  });
});

describe("sanitizeHtml", () => {
  it("허용 태그만 남기고 스크립트·이벤트 속성을 지운다", () => {
    expect(sanitizeHtml('<h1 class="x">제목</h1><p onclick="alert(1)">본문<script>alert(1)</script></p>')).toBe("<h1>제목</h1><p>본문</p>");
    expect(sanitizeHtml('<div><span style="color:red">글</span></div>')).toBe("글");
    expect(sanitizeHtml("<iframe src=x></iframe><style>p{}</style>끝")).toBe("끝");
  });
  it("링크는 http(s)만, 이미지는 https 또는 같은 출처만", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a target="_blank" rel="noopener noreferrer nofollow">x</a>');
    expect(sanitizeHtml('<a href="https://a.com/?q=1&amp;b=2">x</a>')).toBe('<a href="https://a.com/?q=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">x</a>');
    expect(sanitizeHtml('<img src="/api/public/asset/lead-assets/w/1" alt="a"><img src="//evil.com/x"><img src="data:image/png;base64,AA" onerror="x()">')).toBe(
      '<img src="/api/public/asset/lead-assets/w/1" alt="a"><img><img>',
    );
  });
  it("깨진 태그와 속성 안 따옴표 탈출을 막는다", () => {
    expect(sanitizeHtml("1 < 2 <p>ok</p>")).toBe("1 &lt; 2 <p>ok</p>");
    expect(sanitizeHtml('<img src="https://a.com/x.png" alt="a&quot; onerror=&quot;x">')).toBe('<img src="https://a.com/x.png" alt="a&quot; onerror=&quot;x">');
    expect(sanitizeHtml("<p>a<!-- <script>x</script> -->b</p>")).toBe("<p>ab</p>");
  });
});
