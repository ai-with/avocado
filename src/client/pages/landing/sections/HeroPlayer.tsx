import type { RefObject } from "react";
import { IconButton } from "../../../ui";
import { HERO_MOCK } from "../copy";
import { formatClock } from "../useReelClock";

const REEL_SRC = "/videos/hero-reel";
const percent = (seconds: number) => `${(seconds / HERO_MOCK.duration) * 100}%`;

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  time: number;
  playing: boolean;
  onToggle: () => void;
};

// 제출 영상 미리보기. 진행 바의 색점은 오른쪽 카드 시점이다
export function HeroPlayer({ videoRef, time, playing, onToggle }: Props) {
  return (
    <div className={`landing-reel ${playing ? "" : "is-paused"}`}>
      <video ref={videoRef} className="landing-reel-video" muted loop playsInline preload="metadata"
        poster={`${REEL_SRC}.jpg`} aria-label="제출 영상: 세럼을 들고 말하는 뷰티 릴스">
        <source src={`${REEL_SRC}.webm`} type="video/webm" />
        <source src={`${REEL_SRC}.mp4`} type="video/mp4" />
      </video>
      <span className="landing-reel-chip landing-reel-tag">제출 영상</span>
      <IconButton icon={playing ? "pause" : "play"} label={playing ? "일시정지" : "재생"}
        variant="secondary" className="landing-reel-toggle" onClick={onToggle} />
      <div className="landing-reel-foot">
        <span className="landing-reel-chip landing-reel-clock">{formatClock(time)} / {formatClock(HERO_MOCK.duration)}</span>
        <div className="landing-reel-track" aria-hidden="true">
          <div className="landing-reel-progress" style={{ width: percent(time) }} />
          {HERO_MOCK.candidates.map((c) => (
            <span key={c.seconds} className={`landing-reel-marker is-${c.tone}`} style={{ left: percent(c.seconds) }} />
          ))}
        </div>
      </div>
    </div>
  );
}
