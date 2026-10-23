import { useEffect, useRef, useState } from "react";
import { Button } from "../../../ui";
import { SHOWCASE, type ShowcaseVideo } from "../showcase";
import { LandingSection } from "./Features";

const VISIBLE_RATIO = 0.4;
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 화면에 들어올 때만 재생해 데이터를 아낀다. 움직임 줄이기 설정이면 자동 재생하지 않는다
function useInViewPlayback(enabled: boolean) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || !enabled) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void video.play().catch(() => undefined);
      else video.pause();
    }, { threshold: VISIBLE_RATIO });
    observer.observe(video);
    return () => observer.disconnect();
  }, [enabled]);
  return ref;
}

function ShowcaseItem({ v }: { v: ShowcaseVideo }) {
  const [reduced] = useState(prefersReducedMotion);
  const [started, setStarted] = useState(false);
  const ref = useInViewPlayback(!reduced || started);
  const src = `/videos/${v.file}`;
  return (
    <li className="landing-showcase-item">
      <div className="landing-showcase-head">
        <h3>{v.title}</h3>
        <p className="landing-section-sub">{v.desc}</p>
      </div>
      <div className="landing-showcase-frame">
        <video ref={ref} className="landing-showcase-video" muted loop playsInline preload="metadata"
          poster={`${src}.jpg`} aria-label={v.title}>
          <source src={`${src}.webm`} type="video/webm" />
          <source src={`${src}.mp4`} type="video/mp4" />
        </video>
        {reduced && !started && (
          <Button variant="secondary" className="landing-showcase-play" onClick={() => setStarted(true)}>영상 재생</Button>
        )}
      </div>
    </li>
  );
}

export function Showcase() {
  return (
    <LandingSection id={SHOWCASE.id} title={SHOWCASE.title}>
      <ul className="landing-showcase">
        {SHOWCASE.videos.map((v) => <ShowcaseItem key={v.file} v={v} />)}
      </ul>
    </LandingSection>
  );
}
