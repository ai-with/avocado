import { ButtonLink } from "../../../ui";
import { HERO } from "../copy";

// "시작하기" 큰 버튼. 히어로와 최하단 최종 CTA가 함께 쓴다
export function LandingCta() {
  return (
    <div className="landing-cta-row">
      <ButtonLink variant="primary" to="/signup" className="landing-cta">{HERO.primary}</ButtonLink>
    </div>
  );
}

