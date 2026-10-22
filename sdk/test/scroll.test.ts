import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installScrollCapture, type ScrollTracker } from "../src/capture/scroll";
import type { EventInput } from "../src/types";
import { setDocumentSize } from "./helpers";

let events: EventInput[] = [];
let tracker: ScrollTracker;

function scrollTo(y: number): void {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  window.dispatchEvent(new Event("scroll"));
  vi.advanceTimersByTime(200);
}

beforeEach(() => {
  vi.useFakeTimers();
  events = [];
  setDocumentSize(1000, 4000);
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
  tracker = installScrollCapture([25, 50, 75, 100], (e) => events.push(e));
});
afterEach(() => {
  tracker.uninstall();
  vi.useRealTimers();
});

describe("스크롤 깊이", () => {
  it("임계값을 처음 넘을 때 1회씩만 보낸다", () => {
    scrollTo(0); // 25%
    scrollTo(1500); // 62.5%
    scrollTo(0);
    scrollTo(1500);
    expect(events).toEqual([
      { t: "scroll", depth: 25 },
      { t: "scroll", depth: 50 },
    ]);
    scrollTo(3000);
    expect(events.map((e) => (e.t === "scroll" ? e.depth : 0))).toEqual([25, 50, 75, 100]);
  });

  it("빠르게 여러 번 스크롤해도 200ms에 한 번, 마지막 위치로 확인한다", () => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 3000 });
    for (let i = 0; i < 10; i++) window.dispatchEvent(new Event("scroll"));
    expect(events).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(events).toHaveLength(4);
  });

  it("경로가 바뀌면(reset) 다시 보낸다", () => {
    scrollTo(0);
    tracker.reset();
    scrollTo(0);
    expect(events).toHaveLength(2);
  });
});
