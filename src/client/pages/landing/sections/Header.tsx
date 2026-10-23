import { Link } from "react-router-dom";
import { ButtonLink } from "../../../ui";
import { useMe } from "../../../lib/me";
import { BRAND, NAV_ANCHORS } from "../copy";

export function LandingHeader() {
  const { me } = useMe();
  return (
    <header className="landing-header">
      <div className="landing-container landing-header-inner">
        <Link to="/" className="landing-logo">{BRAND}</Link>
        <nav className="landing-anchors" aria-label="섹션">
          {NAV_ANCHORS.map((a) => <a key={a.href} href={a.href}>{a.label}</a>)}
        </nav>
        <div className="landing-header-actions">
          {me ? (
            <ButtonLink variant="primary" to="/dashboard">대시보드로 가기</ButtonLink>
          ) : (
            <>
              <ButtonLink variant="ghost" to="/login" className="landing-header-login">로그인</ButtonLink>
              <ButtonLink variant="primary" to="/signup">무료로 시작</ButtonLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
