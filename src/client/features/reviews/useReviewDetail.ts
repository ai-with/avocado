import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import type { ActFn, Frame, ReviewDetail } from "./types";

const POLL_MS = 10_000;
const isProcessing = (d: ReviewDetail) => d.submission.status === "processing" || d.submission.status === "uploaded";

// 처리 중이면 10초마다 새로 읽는다
function usePollWhileProcessing(d: ReviewDetail | null, load: () => Promise<void>) {
  useEffect(() => {
    if (!d || !isProcessing(d)) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [d, load]);
}

// 영상 위치 이동과 프레임 선택
function useFramePicker(base: string, frames: Frame[]) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const seek = (tMs: number) => {
    if (video.current) {
      video.current.currentTime = tMs / 1000;
      video.current.pause();
    }
  };
  const pickFrame = (f: Frame) => {
    setFrame(f);
    seek(f.tMs);
    void api.post(`${base}/frame-selected`).catch(() => undefined);
  };
  // 재생 위치에 가장 가까운 프레임
  const pickCurrent = () => {
    const t = (video.current?.currentTime ?? 0) * 1000;
    const f = [...frames].sort((a, b) => Math.abs(a.tMs - t) - Math.abs(b.tMs - t))[0] ?? null;
    if (f) pickFrame(f);
  };
  return { frame, video, seek, pickFrame, pickCurrent };
}

// 검수 화면 데이터·프레임 선택·영상 이동·요청 실행
export function useReviewDetail(submissionId: string) {
  const toast = useToast();
  const [d, setD] = useState<ReviewDetail | null>(null);
  const base = `/reviews/${submissionId}`;
  const load = useCallback(async () => setD(await api.get<ReviewDetail>(base)), [base]);
  useEffect(() => void load(), [load]);
  usePollWhileProcessing(d, load);
  const picker = useFramePicker(base, d?.frames ?? []);

  const act: ActFn = async (fn, done) => {
    try {
      await fn();
      if (done) toast(done, "success");
      await load();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  const approve = () =>
    confirm("최종 승인할까요? 승인하면 코멘트를 더 바꿀 수 없고, 인플루언서에게 게시 안내가 가요.") && void act(() => api.post(`${base}/approve`), "최종 승인했어요.");

  return { d, base, load, act, approve, ...picker, processing: d ? isProcessing(d) : false };
}
