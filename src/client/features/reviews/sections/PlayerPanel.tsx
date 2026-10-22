import type { RefObject } from "react";
import type { Frame, ReviewDetail } from "../types";
import { FrameThumb } from "./FrameThumb";

type Props = { d: ReviewDetail; video: RefObject<HTMLVideoElement | null>; selected: Frame | null; processing: boolean; onPick: (f: Frame) => void };

// 왼쪽: 영상 플레이어 + 프레임 목록
export function PlayerPanel({ d, video, selected, processing, onPick }: Props) {
  return (
    <div className="stack review-left">
      {d.submission.videoUrl && <video ref={video} className="review-player" src={d.submission.videoUrl} controls playsInline preload="metadata" />}
      {d.frames.length > 0 ? (
        <div className="frame-strip" role="list" aria-label="프레임">
          {d.frames.map((f) => <FrameThumb key={f.id} f={f} role="listitem" active={selected?.id === f.id} onClick={() => onPick(f)} />)}
        </div>
      ) : (
        <p className="text-caption">{processing ? "프레임을 준비하는 중이에요." : "추출된 프레임이 없어요."}</p>
      )}
    </div>
  );
}
