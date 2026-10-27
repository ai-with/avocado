import type { DocumentGate } from "./leads";

// 0008 이전 형식. before = 열기 전, after_page = page 쪽까지 보여 준 뒤
export type LegacyDocumentGate = Omit<DocumentGate, "position" | "scrollPct"> & { position: "before" | "after_page"; page: number };
export type StoredGate = DocumentGate | LegacyDocumentGate;

const isLegacy = (g: StoredGate): g is LegacyDocumentGate => g.position === "before" || g.position === "after_page";
const clampPct = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

// 예전 게이트를 스크롤 비율 게이트로 바꾼다. after_page 는 전체 쪽수 대비 비율로 환산
export function normalizeGate(g: StoredGate, pages: number): DocumentGate {
  if (isLegacy(g)) {
    const { page, position, ...rest } = g;
    return { ...rest, position: "scroll", scrollPct: position === "before" ? 0 : clampPct((page / Math.max(1, pages)) * 100) };
  }
  return { ...g, scrollPct: clampPct(g.scrollPct ?? 0) };
}

// 본문 전체 높이 대비 화면에 보인 최하단 위치(%)
export function visiblePct(scrollTop: number, viewportHeight: number, contentHeight: number): number {
  if (contentHeight <= viewportHeight) return 100;
  return clampPct(((scrollTop + viewportHeight) / contentHeight) * 100);
}

// 최하단이 gatePct 에 닿는 스크롤 위치. 게이트 통과 전에는 이보다 더 내려갈 수 없다
export function gateScrollTop(gatePct: number, viewportHeight: number, contentHeight: number): number {
  return Math.max(0, (gatePct / 100) * contentHeight - viewportHeight);
}

export const COMPLETE_PCT = 95;

// 글자가 없어도 화면 높이를 차지하는 블록(그림, 구분선)의 무게. 글자 수로 환산한 값
const MEDIA_BLOCK_WEIGHT = 200;
const MIN_BLOCK_WEIGHT = 20;
const VOID_TAGS = new Set(["hr", "br", "img"]);

// 정리된(sanitizeHtml) HTML 을 최상위 블록 단위로 나눈다. 속성값의 < > 는 이미 이스케이프돼 있다
export function topLevelBlocks(html: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let start = 0;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g)) {
    const closing = m[1] === "/";
    const isVoid = VOID_TAGS.has(m[2]!.toLowerCase());
    if (!isVoid) depth += closing ? -1 : 1;
    if (depth > 0) continue;
    depth = 0;
    blocks.push(html.slice(start, m.index + m[0].length));
    start = m.index + m[0].length;
  }
  if (html.slice(start).trim()) blocks.push(html.slice(start));
  return blocks;
}

const blockWeight = (block: string) => {
  const text = block.replace(/<[^>]*>/g, "").trim().length;
  return /<(img|hr)\b/i.test(block) ? Math.max(text, MEDIA_BLOCK_WEIGHT) : Math.max(text, MIN_BLOCK_WEIGHT);
};

// 게이트 비율(gatePct) 앞에서 시작하는 블록까지를 head, 나머지를 rest 로 나눈다. 높이는 글자 수로 어림한다
export function splitAtGate(html: string, gatePct: number): { head: string; rest: string } {
  const blocks = topLevelBlocks(html);
  const weights = blocks.map(blockWeight);
  const cut = (weights.reduce((a, b) => a + b, 0) * gatePct) / 100;
  let acc = 0;
  let n = 0;
  while (n < blocks.length && acc < cut) acc += weights[n++]!;
  return { head: blocks.slice(0, n).join(""), rest: blocks.slice(n).join("") };
}
