import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { DocumentSourceType } from "../../../shared/leads";
import { gateScrollTop, visiblePct } from "../../../shared/doc-gate";

type Scroller = { top: number; view: number; height: number; scrollTo: (y: number) => void; lockTarget: HTMLElement };
type Progress = (p: { pct: number; page: number }) => void;
type Refs = { bodyRef: RefObject<HTMLDivElement | null>; frameRef: RefObject<HTMLIFrameElement | null> };

// iframe 안 스크롤은 리스너가 막힐 수 있어 이 간격으로 같이 확인한다
const IFRAME_POLL_MS = 250;

// 스크롤 대상: 주소 원본은 iframe 문서, 나머지는 본문 영역
function useScroller(sourceType: DocumentSourceType, { bodyRef, frameRef }: Refs) {
  return useCallback((): Scroller | null => {
    if (sourceType === "url") {
      const w = frameRef.current?.contentWindow;
      const d = frameRef.current?.contentDocument;
      if (!w || !d?.documentElement) return null;
      return { top: w.scrollY, view: w.innerHeight, height: d.documentElement.scrollHeight, scrollTo: (y) => w.scrollTo(0, y), lockTarget: d.documentElement };
    }
    const b = bodyRef.current;
    if (!b) return null;
    return { top: b.scrollTop, view: b.clientHeight, height: b.scrollHeight, scrollTo: (y) => b.scrollTo(0, y), lockTarget: b };
  }, [sourceType]);
}

// 다이얼로그가 떠 있는 동안 본문 스크롤 잠금
function useScrollLock(dialog: boolean, scroller: () => Scroller | null, ready: boolean) {
  useEffect(() => {
    const s = scroller();
    if (!s) return;
    s.lockTarget.style.overflow = dialog ? "hidden" : "";
  }, [dialog, scroller, ready]);
}

function useScrollListeners(check: () => void, sourceType: DocumentSourceType, { bodyRef, frameRef }: Refs) {
  useEffect(() => {
    check();
    const b = bodyRef.current;
    b?.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    const poll = sourceType === "url" ? setInterval(check, IFRAME_POLL_MS) : undefined;
    const w = frameRef.current?.contentWindow;
    w?.addEventListener("scroll", check, { passive: true });
    return () => {
      b?.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      w?.removeEventListener("scroll", check);
      clearInterval(poll);
    };
  }, [check, sourceType]);
}

type GateScrollArgs = Refs & {
  sourceType: DocumentSourceType;
  needGate: boolean;
  scrollPct: number;
  ready: boolean;
  page: RefObject<number>;
  onProgress?: Progress;
};

// 보인 최하단이 게이트 비율에 닿으면 다이얼로그를 띄우고 그 아래로 못 내려가게 되돌린다
export function useGateScroll({ sourceType, needGate, scrollPct, ready, page, onProgress, ...refs }: GateScrollArgs) {
  const [dialog, setDialog] = useState(needGate && scrollPct === 0);
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;

  useEffect(() => {
    if (!needGate) setDialog(false);
    else if (scrollPct === 0) setDialog(true);
  }, [needGate, scrollPct]);

  const scroller = useScroller(sourceType, refs);
  const check = useCallback(() => {
    const s = scroller();
    if (!s || !ready) return;
    const pct = visiblePct(s.top, s.view, s.height);
    if (needGate && scrollPct > 0 && pct >= scrollPct) {
      const limit = gateScrollTop(scrollPct, s.view, s.height);
      if (s.top > limit + 1) s.scrollTo(limit);
      setDialog(true);
      progressRef.current?.({ pct: scrollPct, page: page.current });
      return;
    }
    progressRef.current?.({ pct, page: page.current });
  }, [scroller, ready, needGate, scrollPct]);

  useScrollLock(dialog, scroller, ready);
  useScrollListeners(check, sourceType, refs);
  return { dialog, setDialog };
}
