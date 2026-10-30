import { useEffect, useState } from "react";
import { countdown } from "../../../../shared/deadline";
import type { T } from "../guideTypes";

// 마감일 2026.11.30 (D-34 12:03:45.123). requestAnimationFrame 이라 탭이 숨겨지면 브라우저가 멈춘다
export function DeadlineCountdown({ at, t }: { at: number; t: T }) {
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const current = Date.now();
      setNowMs(current);
      if (current < at) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [at]);
  const c = countdown(at, nowMs);
  return (
    <p className={`pub-deadline text-caption${c.past ? " is-past" : ""}`}>
      {t("deadline_label")} {c.date} {c.past ? `· ${t("deadline_past")}` : `(D-${c.days} ${c.clock})`}
    </p>
  );
}
