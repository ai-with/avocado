import type { ScrollDepth } from "../config";
import type { Emit, Uninstall } from "../types";

// scroll 이벤트를 매번 계산하지 않고 이 간격으로만 본다 (핸들러 1ms 이하 목표, docs/14 8-4)
const CHECK_INTERVAL_MS = 200;

/** 지금 화면 아래 끝이 문서 높이의 몇 %인지 */
export function currentDepthPercent(): number {
  const root = document.documentElement;
  const height = Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0);
  if (height <= 0) return 100;
  return Math.min(100, ((window.scrollY + window.innerHeight) / height) * 100);
}

export interface ScrollTracker {
  /** SPA 경로가 바뀌면 도달 기록을 비운다 */
  reset(): void;
  check(): void;
  /** 200ms 뒤 한 번 확인한다 (스크롤 이벤트와 같은 경로) */
  schedule(): void;
  uninstall: Uninstall;
}

/** 페이지마다 임계값을 처음 넘을 때 1회씩만 보낸다 */
export function installScrollCapture(thresholds: readonly ScrollDepth[], emit: Emit): ScrollTracker {
  const reached = new Set<ScrollDepth>();
  let pending: ReturnType<typeof setTimeout> | undefined;
  const check = (): void => {
    const percent = currentDepthPercent();
    for (const depth of thresholds) {
      if (percent < depth || reached.has(depth)) continue;
      reached.add(depth);
      emit({ t: "scroll", depth });
    }
  };
  // 200ms에 한 번, 마지막 위치까지 보도록 뒤쪽에서 확인한다
  const schedule = (): void => {
    pending ??= setTimeout(() => {
      pending = undefined;
      check();
    }, CHECK_INTERVAL_MS);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  return {
    reset: () => reached.clear(),
    check,
    schedule,
    uninstall: () => {
      clearTimeout(pending);
      window.removeEventListener("scroll", schedule);
    },
  };
}
