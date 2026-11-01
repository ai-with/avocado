import { useState } from "react";
import { Button } from "../../../ui";
import { SHOWCASE, type ShowcaseVideo } from "../showcase";
import { LandingSection } from "./Features";
import { prefersReducedMotion, useInViewPlayback } from "../useInViewPlayback";

function ShowcaseItem({ v }: { v: ShowcaseVideo }) {
  const [reduced] = useState(prefersReducedMotion);
  const [started, setStarted] = useState(false);
  const ref = useInViewPlayback(!reduced || started);
  const src = `/videos/${v.file}`;
  const videoSrc = `/videos/${v.videoFile ?? v.file}`;
  return (
    <li className="landing-showcase-item">
      <div className="landing-showcase-head">
        <h3>{v.title}</h3>
        <p className="landing-section-sub">{v.desc}</p>
      </div>
      <div className="landing-showcase-frame">
        <video ref={ref} className="landing-showcase-video" muted loop playsInline preload="metadata"
          poster={`${src}.jpg`} aria-label={v.title}>
          <source src={`${videoSrc}.webm`} type="video/webm" />
          <source src={`${videoSrc}.mp4`} type="video/mp4" />
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
