// 상품 페이지 HTML 에서 제품 정보를 뽑는다 (가이드 '상품 URL로 채우기').
// 새 패키지 없이 정규식으로 meta·JSON-LD·본문만 본다. 자바스크립트로 그리는 페이지는 비어 나올 수 있다
const BODY_TEXT_CHARS = 4000;
const MAX_IMAGES = 5;
// 쇼핑몰이 사진 없을 때 넣는 대체 이미지(Shopify no-image 등)는 버린다
const PLACEHOLDER_IMAGE = /no-image|placeholder/i;

export type ProductPage = { name: string; description: string; images: string[]; text: string };
type JsonLdProduct = { name: string; description: string; images: string[] };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, code: string) => {
    if (/^#x/i.test(code)) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (/^#\d+$/.test(code)) return String.fromCodePoint(Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();

function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out.set(m[1]!.toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

// property(og:*) 와 name(description) 을 같은 표로 모은다. 같은 키는 처음 값을 쓴다
function metaTags(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(tag);
    const key = (a.get("property") ?? a.get("name") ?? "").toLowerCase();
    const content = a.get("content");
    if (key && content && !out.has(key)) out.set(key, clean(content));
  }
  return out;
}

function imageUrls(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(imageUrls);
  if (value && typeof value === "object" && "url" in value) return imageUrls((value as { url: unknown }).url);
  return [];
}

const isProductType = (t: unknown) => (Array.isArray(t) ? t.includes("Product") : t === "Product");

// 배열, @graph 안쪽까지 훑어 첫 Product 를 찾는다
function findProduct(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findProduct(n);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  if (isProductType(obj["@type"])) return obj;
  return findProduct(obj["@graph"]);
}

function jsonLdProduct(html: string): JsonLdProduct | null {
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!.trim());
    } catch {
      continue;
    }
    const p = findProduct(data);
    if (p) return { name: clean(String(p.name ?? "")), description: clean(String(p.description ?? "")), images: imageUrls(p.image) };
  }
  return null;
}

export function bodyText(html: string): string {
  const stripped = html
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  return clean(stripped).slice(0, BODY_TEXT_CHARS);
}

function absoluteImages(urls: string[], baseUrl: string): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    try {
      const abs = new URL(decodeEntities(u.trim()), baseUrl);
      if ((abs.protocol === "https:" || abs.protocol === "http:") && !PLACEHOLDER_IMAGE.test(abs.pathname)) out.add(abs.toString());
    } catch {
      // 잘못된 주소는 버린다
    }
  }
  return [...out].slice(0, MAX_IMAGES);
}

export function extractProductPage(html: string, baseUrl: string): ProductPage {
  const meta = metaTags(html);
  const ld = jsonLdProduct(html);
  const title = clean(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  return {
    name: ld?.name || meta.get("og:title") || title,
    description: ld?.description || meta.get("og:description") || meta.get("description") || "",
    images: absoluteImages([...(ld?.images ?? []), meta.get("og:image") ?? ""].filter(Boolean), baseUrl),
    text: bodyText(html),
  };
}
