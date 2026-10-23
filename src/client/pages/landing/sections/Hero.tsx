import { Badge, Icon } from "../../../ui";
import { HERO, HERO_MOCK } from "../copy";
import { LandingCta } from "./Cta";

// 검수 화면 목업. 외부 이미지 없이 토큰 스타일로만 그린다
function ReviewMock() {
  return (
    <div className="landing-mock" aria-label="검수 화면 예시">
      <div className="landing-mock-player"><span className="landing-mock-tag">[예시]</span></div>
      <div className="landing-mock-side">
        {HERO_MOCK.candidates.map((c) => (
          <div key={c.time} className="landing-mock-card">
            <span className="landing-mock-time">{c.time}</span>
            <Badge tone={c.tone}>{c.label}</Badge>
          </div>
        ))}
        <div className="landing-mock-card landing-mock-line">
          <p>{HERO_MOCK.line}</p>
          <p className="text-secondary">{HERO_MOCK.translation}</p>
        </div>
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
