import { cleanEventUrl } from "../attribution";
import type { Uninstall } from "../types";

type HistoryMethod = "pushState" | "replaceState";

/**
 * SPA 경로 변경 감지: pushState·replaceState를 감싸고 popstate를 듣는다.
 * 경로(pathname + 남길 쿼리)가 바뀔 때만 onChange (PostHog history_change와 같은 방식, docs/14 8-3)
 */
export function installRouteWatcher(onChange: () => void): Uninstall {
  let current = cleanEventUrl(location.href);
  const check = (): void => {
    const next = cleanEventUrl(location.href);
    if (next === current) return;
    current = next;
    onChange();
  };
  const originals = { pushState: history.pushState, replaceState: history.replaceState };
  const wrap = (method: HistoryMethod): void => {
    const original = originals[method];
    history[method] = function (this: History, ...args: Parameters<History[HistoryMethod]>) {
      original.apply(this, args);
      check();
    };
  };
  wrap("pushState");
  wrap("replaceState");
  window.addEventListener("popstate", check);
  return () => {
    history.pushState = originals.pushState;
    history.replaceState = originals.replaceState;
    window.removeEventListener("popstate", check);
  };
}
