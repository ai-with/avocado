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
