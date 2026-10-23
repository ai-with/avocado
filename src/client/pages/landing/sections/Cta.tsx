import { ButtonLink } from "../../../ui";
import { HERO } from "../copy";

// 랜딩 전용 큰 알약 CTA. 히어로·기능 섹션·최종 CTA가 함께 쓴다
export function LandingCta({ withLogin = false }: { withLogin?: boolean }) {
  return (
    <div className="landing-cta-row">
      <ButtonLink variant="primary" to="/signup" className="landing-cta">{HERO.primary}</ButtonLink>
      {withLogin && <ButtonLink variant="secondary" to="/login" className="landing-cta">{HERO.secondary}</ButtonLink>}
    </div>
  );
}
