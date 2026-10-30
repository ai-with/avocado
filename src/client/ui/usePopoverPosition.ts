import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/** 칸과 목록 사이, 화면 가장자리와 목록 사이 */
const GAP = 4;
const EDGE = 8;

type Placement = { style: CSSProperties; side: "bottom" | "top" };

// 아래 공간이 목록 높이보다 모자라고 위가 더 넓으면 위로 연다. 좌우는 화면 안으로 밀어 넣는다
export function placePopover(anchor: Pick<DOMRect, "top" | "bottom" | "left" | "width">, viewport: { width: number; height: number }, wanted: { maxHeight: number; minWidth: number }): Placement {
  const below = viewport.height - anchor.bottom - GAP - EDGE;
  const above = anchor.top - GAP - EDGE;
  const side = below < wanted.maxHeight && above > below ? "top" : "bottom";
  const width = Math.min(Math.max(anchor.width, wanted.minWidth), viewport.width - EDGE * 2);
  const left = Math.min(Math.max(anchor.left, EDGE), viewport.width - EDGE - width);
  const maxHeight = Math.max(Math.min(wanted.maxHeight, side === "bottom" ? below : above), 0);
  const vertical = side === "bottom" ? { top: anchor.bottom + GAP } : { bottom: viewport.height - anchor.top + GAP };
  return { side, style: { position: "fixed", left, width, maxHeight, ...vertical } };
}

const outOfView = (r: DOMRect) => r.bottom < 0 || r.top > window.innerHeight;

const readPx = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;

// position: fixed 로 몸(body)에 붙인 목록을 칸 옆에 둔다. 표·모달처럼 overflow 가 잘리는 곳 안에서도 보인다
// 스크롤·창 크기 변경 때 따라가고, 칸이 화면 밖으로 나가면 onLost(닫기)를 부른다. 목록 자체 스크롤은 무시한다
export function usePopoverPosition(open: boolean, anchorRef: RefObject<HTMLElement | null>, popRef: RefObject<HTMLElement | null>, onLost: () => void) {
  const [placement, setPlacement] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    if (!open) return setPlacement(null);
    const wanted = { maxHeight: readPx("--select-menu-max-height"), minWidth: readPx("--select-menu-min-width") };
    const update = (e?: Event) => {
      if (e && popRef.current?.contains(e.target as Node)) return;
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (outOfView(rect)) return onLost();
      setPlacement(placePopover(rect, { width: window.innerWidth, height: window.innerHeight }, wanted));
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorRef, popRef, onLost]);
  return placement;
}
