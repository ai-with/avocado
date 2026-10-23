import { describe, expect, it } from "vitest";
import { unsafeUrlReason } from "./safe-fetch";
import { extractProductPage } from "./product-page";

describe("unsafeUrlReason", () => {
  it("공개 상품 페이지 주소는 허용한다", () => {
    expect(unsafeUrlReason("https://www.example-shop.com/products/serum?id=1")).toBeNull();
    expect(unsafeUrlReason("http://shop.example.co.kr:443/item/3")).toBeNull();
  });
  it.each([
    ["http://127.0.0.1/", "ip_literal"],
    ["http://169.254.169.254/latest/meta-data/", "ip_literal"],
    ["http://10.0.0.5/admin", "ip_literal"],
    ["http://192.168.1.1/", "ip_literal"],
    ["http://2130706433/", "ip_literal"],
    ["http://0x7f.1/", "ip_literal"],
    ["http://[::1]/", "ip_literal"],
    ["http://localhost:8787/", "bad_port"],
    ["http://localhost/", "local_host"],
    ["http://api.localhost/", "local_host"],
    ["http://printer.local/", "local_host"],
    ["http://intranet/", "local_host"],
    ["ftp://example.com/file", "bad_protocol"],
    ["file:///etc/passwd", "bad_protocol"],
    ["https://user:pw@example.com/", "credentials"],
    ["not a url", "invalid_url"],
  ])("%s 는 거부한다 (%s)", (url, reason) => {
    expect(unsafeUrlReason(url)).toBe(reason);
  });
});

const OG_HTML = `<!doctype html><html><head>
<title>Glow Serum | Shop</title>
<meta name="description" content="Fallback description">
<meta property="og:title" content="Glow Serum 30ml">
<meta content="Brightens dull skin. Lightweight texture. Absorbs fast." property="og:description">
<meta property="og:image" content="/img/serum.jpg?w=800&amp;h=800">
</head><body><script>var x = "hidden";</script><h1>Glow&nbsp;Serum</h1><p>Apply 2 drops after toner.</p></body></html>`;

const JSONLD_HTML = `<html><head><title>Store</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"Page"},
{"@type":["Product"],"name":"Hydra Cream","description":"Deep moisture for 24h.","image":["https://cdn.example.com/no-image-2048.gif",{"url":"https://cdn.example.com/a.png"},"https://cdn.example.com/b.png"]}]}</script>
<meta property="og:title" content="Should not win"></head><body><style>.a{}</style>Body text</body></html>`;

describe("extractProductPage", () => {
  it("og 메타와 title, 본문 텍스트를 뽑는다", () => {
    const page = extractProductPage(OG_HTML, "https://shop.example.com/p/1");
    expect(page.name).toBe("Glow Serum 30ml");
    expect(page.description).toBe("Brightens dull skin. Lightweight texture. Absorbs fast.");
    expect(page.images).toEqual(["https://shop.example.com/img/serum.jpg?w=800&h=800"]);
    expect(page.text).toBe("Glow Serum Apply 2 drops after toner.");
    expect(page.text).not.toContain("hidden");
  });
  it("JSON-LD Product 가 있으면 메타보다 먼저 쓴다", () => {
    const page = extractProductPage(JSONLD_HTML, "https://store.example.com/");
    expect(page.name).toBe("Hydra Cream");
    expect(page.description).toBe("Deep moisture for 24h.");
    expect(page.images).toEqual(["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"]);
    expect(page.text).toBe("Body text");
  });
});
