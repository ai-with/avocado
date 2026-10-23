import { useState } from "react";
import { Button } from "../../../ui";
import { prefersReducedMotion, useInViewPlayback } from "../useInViewPlayback";
import { formatClock, useReelClock } from "../useReelClock";
import { DEMO_COPY, REEL_SRC } from "./demoCopy";
import { DemoFrame } from "./DemoFrame";
import "./transcript.css";

const COPY = DEMO_COPY.transcript;

// 재생 위치에 걸린 마지막 줄. 첫 줄 전이면 -1
function currentLine(time: number) {
  let index = -1;
  COPY.lines.forEach((line, i) => { if (time >= line.at) index = i; });
  return index;
}

// 이 데모는 단계 대신 실제 영상 시각을 따라간다. 화면에 들어오면 재생, 나가면 멈춤(useInViewPlayback)
export function TranscriptDemo() {
  const [reduced] = useState(prefersReducedMotion);
  const [showKo, setShowKo] = useState(false);
  const videoRef = useInViewPlayback(!reduced);
  const time = useReelClock(videoRef);
  const active = currentLine(time);

  const seek = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    void video.play().catch(() => undefined);
  };

  return (
    <DemoFrame label={COPY.label} frameRef={null} onReplay={() => seek(0)} className="transcript-demo">
      <div className="transcript-layout">
        <div className="transcript-reel">
          <video ref={videoRef} muted loop playsInline preload="metadata" poster={`${REEL_SRC}.jpg`}
            aria-label="제출 영상: 세럼을 바르는 뷰티 릴스">
            <source src={`${REEL_SRC}.webm`} type="video/webm" />
            <source src={`${REEL_SRC}.mp4`} type="video/mp4" />
          </video>
          <span className="transcript-clock demo-mono">{formatClock(time)}</span>
        </div>
        <div className="transcript-side">
          <Button size="sm" variant="secondary" className="transcript-toggle" aria-pressed={showKo}
            onClick={() => setShowKo(!showKo)}>{showKo ? COPY.hideKo : COPY.showKo}</Button>
          <ol className="transcript-lines">
            {COPY.lines.map((line, i) => (
              <li key={line.at}>
                <button type="button" className={`transcript-line ${i === active ? "is-current" : ""}`}
                  aria-current={i === active} onClick={() => seek(line.at)}>
                  <span className="demo-mono">{formatClock(line.at)}</span>
                  <span className="transcript-text">
                    <span>{line.en}</span>
                    {showKo && <span className="transcript-ko">{line.ko}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </DemoFrame>
  );
}
