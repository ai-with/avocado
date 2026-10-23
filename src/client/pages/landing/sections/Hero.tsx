import { useEffect, useRef, useState } from "react";
import { Badge, Icon } from "../../../ui";
import { HERO, HERO_MOCK } from "../copy";
import { prefersReducedMotion, useInViewPlayback } from "../useInViewPlayback";
import { formatClock, useReelClock } from "../useReelClock";
import { useSuggestionSequence } from "../useSuggestionSequence";
import { LandingCta } from "./Cta";
import { HeroPlayer } from "./HeroPlayer";
import { LineCard, SuggestionCard } from "./HeroSuggestion";

const CARD_ACTIVE_SECONDS = 1.5;
const SELECTION_WORD_COUNT = HERO_MOCK.suggestion.selection.split(" ").length;
const VIOLATION_SECONDS = HERO_MOCK.candidates.find((c) => c.tone === "danger")?.seconds ?? Infinity;

// 지금 재생 구간에 걸린 카드. 구간이 겹치면 나중 카드를 보여 준다
function activeCandidate(time: number) {
  let index = -1;
  HERO_MOCK.candidates.forEach((c, i) => {
    if (time >= c.seconds && time < c.seconds + CARD_ACTIVE_SECONDS) index = i;
  });
  return index;
}

// 처음 위반 구간에 닿으면 수정 제안을 한 번 저절로 보여 준다. 그 전에 사용자가 눌렀으면 건너뛴다
function useAutoSuggestion(time: number, start: () => void) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || time < VIOLATION_SECONDS) return;
    done.current = true;
    start();
  }, [time, start]);
  return () => { done.current = true; start(); };
}

// 검수 화면 목업. 실제 릴스를 틀고 카드·대사·수정 제안이 재생 위치를 따라간다
function ReviewMock() {
  const [reduced] = useState(prefersReducedMotion);
  const [playing, setPlaying] = useState(!reduced);
  const videoRef = useInViewPlayback(playing);
  const time = useReelClock(videoRef);
  const active = activeCandidate(time);
  const suggestion = useSuggestionSequence(SELECTION_WORD_COUNT, HERO_MOCK.suggestion.ko, reduced);
  const startSuggestion = useAutoSuggestion(time, suggestion.start);

  const toggle = () => {
    if (playing) videoRef.current?.pause();
    setPlaying(!playing);
  };
  const seek = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    void video.play().catch(() => undefined);
    setPlaying(true);
    if (seconds === VIOLATION_SECONDS) startSuggestion();
  };

  return (
    <div className="landing-mock" aria-label="검수 화면">
      <HeroPlayer videoRef={videoRef} time={time} playing={playing} onToggle={toggle} />
      <div className="landing-mock-side">
        {HERO_MOCK.candidates.map((c, i) => (
          <button key={c.seconds} type="button" className={`landing-mock-card landing-mock-cue ${i === active ? "is-active" : ""}`}
            aria-pressed={i === active} onClick={() => seek(c.seconds)}>
            <span className="landing-mock-time">{formatClock(c.seconds)}</span>
            <Badge tone={c.tone}>{c.label}</Badge>
          </button>
        ))}
        <LineCard time={time} suggestion={suggestion.state} />
        <SuggestionCard state={suggestion.state} onSend={suggestion.send} />
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="landing-hero landing-container">
      <div className="landing-hero-text">
        <Badge tone="accent">{HERO.badge}</Badge>
        <h1 className="landing-display">{HERO.title}</h1>
        <p className="landing-sub">{HERO.sub}</p>
        <LandingCta withLogin />
        <ul className="landing-checks">
          {HERO.checks.map((c) => <li key={c}><Icon name="check" size={16} />{c}</li>)}
        </ul>
      </div>
      <ReviewMock />
    </section>
  );
}
