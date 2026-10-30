import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./FloatingActionBar.css";

const SLOT_ID = "floating-bar-slot";
const HEIGHT_VAR = "--floating-bar-height";

// 화면 본문 맨 아래에 두는 자리. 비어 있으면 안 보인다. 자기 높이만큼 본문 흐름에서 자리를 차지해 마지막 내용을 가리지 않는다
export function FloatingActionBarSlot() {
  return <div id={SLOT_ID} className="fab-slot" />;
}

// 자리의 실제 높이를 변수로 알려 앵커·포커스 이동이 줄 아래로 숨지 않게 한다
function useReportHeight(el: HTMLElement | null) {
  useEffect(() => {
    if (!el) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty(HEIGHT_VAR, `${el.offsetHeight}px`));
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(HEIGHT_VAR);
    };
  }, [el]);
}

// 화면 어디를 보든 다음 행동 버튼을 아래에서 바로 누르게 하는 줄. 트리 어디에 두어도 FloatingActionBarSlot 안에 그려진다
export function FloatingActionBar({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setSlot(document.getElementById(SLOT_ID)), []);
  useReportHeight(slot);
  if (!slot) return null;
  return createPortal(<div className="fab">{children}</div>, slot);
}
