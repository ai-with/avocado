import { ButtonAnchor, ButtonLink } from "../../../ui";
import { HERO } from "../copy";

// "무료 파일럿 신청"은 최하단 최종 CTA에만 둔다(2026-10-23 사용자 결정)
export function LandingCta() {
  return (
    <div className="landing-cta-row">
      <ButtonLink variant="primary" to="/signup" className="landing-cta">{HERO.primary}</ButtonLink>
    </div>
  );
}

// 히어로 버튼 자리: 기능 섹션으로 내려가는 보조 버튼과 로그인
export function HeroActions() {
  return (
    <div className="landing-cta-row">
      <ButtonAnchor variant="secondary" href="#features" className="landing-cta">{HERO.tour}</ButtonAnchor>
      <ButtonLink variant="ghost" to="/login" className="landing-cta">{HERO.secondary}</ButtonLink>
    </div>
  );
}
