import { Link } from "react-router-dom";
import { BRAND, FINAL_CTA, FOOTER_LINKS, FOOTER_PLACEHOLDERS } from "../copy";
import { LandingCta } from "./Cta";

export function FinalCta() {
  return (
    <section className="landing-final landing-container">
      <h2>{FINAL_CTA.title}</h2>
      <LandingCta />
      <p className="landing-note">{FINAL_CTA.note}</p>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-container landing-footer-inner">
        <span className="landing-logo">{BRAND}</span>
        <nav className="landing-footer-links" aria-label="바닥글">
          {FOOTER_LINKS.map((l) => <Link key={l.to} to={l.to}>{l.label}</Link>)}
          {/* 문의 주소·약관·개인정보 처리방침은 법률 검토 뒤 채운다 (docs/05 B13) */}
          {FOOTER_PLACEHOLDERS.map((label) => <a key={label} href="#">{label}</a>)}
        </nav>
      </div>
    </footer>
  );
}
