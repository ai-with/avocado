import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import type { DocumentSourceType } from "../../../shared/leads";
import { COMPLETE_PCT } from "../../../shared/doc-gate";
import type { ViewerGate } from "./DocViewer";

export type DocMeta = {
  viewToken: string;
  title: string;
  sourceType: DocumentSourceType;
  pages: number;
  allowDownload: boolean;
  brandName: string;
  gate: ViewerGate;
  gatePassed: boolean;
  html: string | null;
  hasSnapshot: boolean;
  sourceUrl: string | null;
};

const DWELL_TICK_MS = 1000;
const FLUSH_INTERVAL_MS = 5000;

type Track = { dwell: Map<number, number>; current: number; maxPage: number; maxScroll: number; completed: boolean; last: number };

// 자료 정보 불러오기. v 는 이미 받은 열람 토큰(게이트 통과 뒤 다시 읽을 때)
export function usePublicDoc(slug: string) {
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    (v: string | null) => api.get<DocMeta>(`/public/doc/${slug}${v ? `?v=${encodeURIComponent(v)}` : ""}`, { redirectOn401: false }).then(setMeta),
    [slug],
  );

  // 개발 모드 StrictMode 의 이중 실행으로 열람이 두 번 기록되지 않게 한 번만 부른다
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    load(new URLSearchParams(location.search).get("v")).catch((e: unknown) => setError(errorMessage(e)));
  }, [load]);
  return { meta, error, load };
}

function useFlush(meta: DocMeta | null, slug: string, track: { current: Track }) {
  return useCallback(
    (beacon: boolean) => {
      if (!meta) return;
      const t = track.current;
      const body = JSON.stringify({
        viewToken: meta.viewToken,
        pages: [...t.dwell.entries()].map(([page, dwellMs]) => ({ page, dwellMs: Math.round(dwellMs) })),
        maxPage: t.maxPage,
        maxScrollPct: t.maxScroll,
        completed: t.completed,
      });
      t.dwell.clear();
      const url = `/api/public/doc/${slug}/events`;
      if (beacon) navigator.sendBeacon(url, body);
      else void fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json" }, credentials: "same-origin", keepalive: true });
    },
    [meta, slug],
  );
}

// 쪽 체류(화면이 보일 때만), 스크롤 깊이, 완독을 5초마다, 화면을 떠날 때 보낸다
function useTrackingTimers(meta: DocMeta | null, flush: (beacon: boolean) => void, track: { current: Track }) {
  useEffect(() => {
    if (!meta) return;
    const t = track.current;
    t.last = Date.now();
    const tick = setInterval(() => {
      const nowMs = Date.now();
      if (document.visibilityState === "visible" && t.maxPage > 0) t.dwell.set(t.current, (t.dwell.get(t.current) ?? 0) + (nowMs - t.last));
      t.last = nowMs;
    }, DWELL_TICK_MS);
    const send = setInterval(() => flush(false), FLUSH_INTERVAL_MS);
    const onHide = () => document.visibilityState === "hidden" && flush(true);
    const onPageHide = () => flush(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(tick);
      clearInterval(send);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [meta, flush]);
}

export function useViewTracking(meta: DocMeta | null, slug: string) {
  const track = useRef<Track>({ dwell: new Map<number, number>(), current: 1, maxPage: 0, maxScroll: 0, completed: false, last: Date.now() });
  const flush = useFlush(meta, slug, track);
  useTrackingTimers(meta, flush, track);
  return useCallback(
    ({ pct, page }: { pct: number; page: number }) => {
      const t = track.current;
      t.current = page;
      t.maxPage = Math.max(t.maxPage, page);
      t.maxScroll = Math.max(t.maxScroll, pct);
      // 완독 = 본문 95% 이상 도달, PDF 는 마지막 쪽이 보여도 완독
      if (pct >= COMPLETE_PCT || (meta?.sourceType === "pdf" && page >= meta.pages)) t.completed = true;
    },
    [meta],
  );
}
