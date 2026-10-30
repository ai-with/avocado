import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AUTH_ASIDE, BRAND } from "./landing/copy";
import "./Auth.css";

type Props = { title?: ReactNode; description?: ReactNode; children?: ReactNode };

// 데스크톱 오른쪽 소개 카드. 1023px 이하에서는 CSS로 숨긴다
function AuthAside() {
  return (
    <aside className="auth-aside" aria-label={`${BRAND} 소개`}>
      <div className="auth-aside-inner">
        <blockquote className="auth-quote">
          <p className="auth-quote-text">{AUTH_ASIDE.quote}</p>
          <p className="text-secondary">{AUTH_ASIDE.quoteSub}</p>
        </blockquote>
        <dl className="auth-stats">
          {AUTH_ASIDE.stats.map((s) => (
            <div key={s.label}>
              <dt className="text-secondary">{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
        <div className="auth-logos">
          <p className="text-caption">{AUTH_ASIDE.logosLabel}</p>
          <p className="text-secondary">{AUTH_ASIDE.logosPlaceholder}</p>
        </div>
      </div>
    </aside>
  );
}

// 로그인·가입·인증 화면이 함께 쓰는 틀: 왼쪽 폼, 오른쪽 소개 카드
export function AuthCard({ title, description, children }: Props) {
  return (
    <div className="auth">
      <div className="auth-main">
        <Link to="/" className="auth-logo">{BRAND}</Link>
        <div className="auth-form">
          {title && <h1 className="auth-title">{title}</h1>}
          {description && <p className="auth-desc">{description}</p>}
          {children}
        </div>
        <p className="auth-legal">© 2026 {BRAND} · <a href="#">이용약관</a> · <a href="#">개인정보</a></p>
      </div>
      <AuthAside />
    </div>
  );
}

// 폼 전체 오류. 필드별 오류는 Input 의 error 로 칸 바로 아래에 보인다
export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return <p className="field-error" role="alert">{message}</p>;
}
