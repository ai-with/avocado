import type { ViewportBucket } from "../../../src/shared/sdk-events";
import type { Emit, Uninstall } from "../types";
import { cssPath, isExcluded } from "./dom";

const TRACKED = "a, button, [role=button], input[type=submit], [data-avc-track]";
const MAX_TEXT_LENGTH = 80;
const MOBILE_MAX_WIDTH = 768;
const TABLET_MAX_WIDTH = 1024;
// rage click: 1초 안 30px 안 3회 (PostHog 정의, docs/14 2장)
const RAGE_WINDOW_MS = 1_000;
const RAGE_RADIUS_PX = 30;
const RAGE_COUNT = 3;

export function normalizeText(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

/** 문서 폭·높이 대비 0~1, 소수 셋째 자리 */
export function normalizeCoord(position: number, size: number): number {
  if (size <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, position / size)) * 1000) / 1000;
}

export function viewportBucket(width: number): ViewportBucket {
  if (width < MOBILE_MAX_WIDTH) return "m";
  return width < TABLET_MAX_WIDTH ? "t" : "d";
}

/** href에서 쿼리와 해시를 뺀다 (토큰·개인정보가 쿼리에 실리는 경우가 많다) */
export function stripHref(element: Element): string | null {
  if (!(element instanceof HTMLAnchorElement) || !element.href) return null;
  try {
    const url = new URL(element.href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function elementText(element: Element): string {
  if (element instanceof HTMLInputElement) return normalizeText(element.value);
  return normalizeText(element.textContent || element.getAttribute("aria-label"));
}

interface ClickPoint {
  x: number;
  y: number;
  at: number;
}

export function createRageDetector(): (point: ClickPoint) => boolean {
  let recent: ClickPoint[] = [];
  return (point) => {
    recent = recent.filter(
      (prev) =>
        point.at - prev.at <= RAGE_WINDOW_MS && Math.hypot(point.x - prev.x, point.y - prev.y) <= RAGE_RADIUS_PX,
    );
    recent.push(point);
    return recent.length >= RAGE_COUNT;
  };
}

export interface ClickCaptureOptions {
  autocapture: boolean;
  emit: Emit;
}

/** document 단일 위임 리스너 (capture 단계, passive) */
export function installClickCapture({ autocapture, emit }: ClickCaptureOptions): Uninstall {
  const isRage = createRageDetector();
  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest(TRACKED) : null;
    if (!target || isExcluded(target)) return;
    const trackName = target.getAttribute("data-avc-track");
    if (trackName) emit({ t: "track", name: trackName, props: {} });
    if (!autocapture) return;
    const root = document.documentElement;
    const rage = isRage({ x: event.pageX, y: event.pageY, at: Date.now() });
    emit({
      t: "click",
      sel: cssPath(target),
      text: elementText(target),
      href: stripHref(target),
      x: normalizeCoord(event.pageX, root.scrollWidth),
      y: normalizeCoord(event.pageY, root.scrollHeight),
      vw: viewportBucket(window.innerWidth),
      ...(rage ? { rage: true as const } : {}),
    });
  };
  document.addEventListener("click", onClick, { capture: true, passive: true });
  return () => document.removeEventListener("click", onClick, { capture: true });
}
