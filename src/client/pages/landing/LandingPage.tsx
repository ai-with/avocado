import { useEffect } from "react";
import { PAGE_TITLE } from "./copy";
import { LandingHeader } from "./sections/Header";
import { Hero } from "./sections/Hero";
import { Features, Problem, Process } from "./sections/Features";
import { Faq } from "./sections/Faq";
import { Showcase } from "./sections/Showcase";
import { FinalCta, LandingFooter } from "./sections/Footer";
import "./landing.css";

// 공개 랜딩 `/`. 섹션 순서는 docs/05-landing-copy.md 3-0
export function LandingPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = PAGE_TITLE;
    return () => { document.title = prev; };
  }, []);
  return (
    <div className="landing">
      <LandingHeader />
      <main>
        <Hero />
        <Problem />
        <Showcase />
        <Features />
        <Process />
        <Faq />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
