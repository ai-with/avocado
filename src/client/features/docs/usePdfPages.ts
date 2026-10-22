import { useEffect, type RefObject } from "react";
import { errorMessage } from "../../lib/api";
import type { DocumentSourceType } from "../../../shared/leads";
import { loadPdfjs } from "../links/common";

const MAX_PAGE_WIDTH_PX = 900;
const VISIBILITY_STEPS = [0, 0.25, 0.5, 0.75, 1];

// 가장 많이 보이는 쪽을 현재 쪽으로 기록한다
function observeCurrentPage(root: HTMLElement | null, page: RefObject<number>) {
  const ratios = new Map<number, number>();
  return new IntersectionObserver(
    (entries) => {
      for (const e of entries) ratios.set(Number((e.target as HTMLElement).dataset.page), e.intersectionRatio);
      const best = [...ratios.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] > 0) page.current = best[0];
    },
    { root, threshold: VISIBILITY_STEPS },
  );
}

type DrawArgs = { fileUrl: string; box: HTMLDivElement; root: HTMLElement | null; io: IntersectionObserver; cancelled: () => boolean; onLaidOut: () => void };

// 모든 쪽의 자리를 먼저 잡아 전체 높이를 확정한 뒤(스크롤 비율이 흔들리지 않게) 차례로 그린다
// ponytail: 모든 쪽을 한 번에 그린다. 수백 쪽 자료가 많아지면 화면 근처만 그리도록 바꾼다
async function drawPdfPages({ fileUrl, box, root, io, cancelled, onLaidOut }: DrawArgs) {
  const pdf = await (await loadPdfjs()).getDocument({ url: fileUrl, withCredentials: true }).promise;
  const width = Math.min(MAX_PAGE_WIDTH_PX, root?.clientWidth ?? window.innerWidth);
  const canvases: { canvas: HTMLCanvasElement; n: number }[] = [];
  box.replaceChildren();
  for (let n = 1; n <= pdf.numPages && !cancelled(); n++) {
    const base = (await pdf.getPage(n)).getViewport({ scale: 1 });
    const canvas = document.createElement("canvas");
    const scale = (width * (window.devicePixelRatio || 1)) / base.width;
    canvas.width = Math.round(base.width * scale);
    canvas.height = Math.round(base.height * scale);
    canvas.dataset.page = String(n);
    box.appendChild(canvas);
    io.observe(canvas);
    canvases.push({ canvas, n });
  }
  if (cancelled()) return;
  onLaidOut();
  for (const { canvas, n } of canvases) {
    if (cancelled()) return;
    const p = await pdf.getPage(n);
    const viewport = p.getViewport({ scale: canvas.width / p.getViewport({ scale: 1 }).width });
    await p.render({ canvas, viewport }).promise;
  }
}

type Args = {
  sourceType: DocumentSourceType;
  html: string | null;
  fileUrl: string | null;
  snapshotUrl: string | null;
  bodyRef: RefObject<HTMLDivElement | null>;
  pagesRef: RefObject<HTMLDivElement | null>;
  page: RefObject<number>;
  setReady: (v: boolean) => void;
  setError: (v: string) => void;
};

// 본문 준비 상태. 직접 쓴 문서와 불러오지 못한 주소는 그리면 바로 준비 완료, PDF 는 쪽 자리를 다 잡으면 준비 완료
export function useViewerContent({ sourceType, html, fileUrl, snapshotUrl, bodyRef, pagesRef, page, setReady, setError }: Args) {
  useEffect(() => {
    if (sourceType === "editor" ? html !== null : sourceType === "url" && !snapshotUrl) setReady(true);
  }, [sourceType, html, snapshotUrl]);

  useEffect(() => {
    const box = pagesRef.current;
    if (sourceType !== "pdf" || !fileUrl || !box) return;
    let cancelled = false;
    const root = bodyRef.current;
    const io = observeCurrentPage(root, page);
    drawPdfPages({ fileUrl, box, root, io, cancelled: () => cancelled, onLaidOut: () => setReady(true) }).catch((e: unknown) => {
      if (!cancelled) setError(errorMessage(e));
    });
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [sourceType, fileUrl]);
}
