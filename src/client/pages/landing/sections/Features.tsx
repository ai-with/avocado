import type { ReactNode } from "react";
import { FEATURES, PROBLEM, PROCESS, type FeatureSection, type Item } from "../copy";
import { LandingCta } from "./Cta";

type SectionProps = { id?: string; title: string; sub?: string; children: ReactNode; tone?: "subtle" };

// 랜딩 섹션 공통 틀: h2 + 부제 + 본문
export function LandingSection({ id, title, sub, children, tone }: SectionProps) {
  return (
    <section id={id} className={`landing-section${tone ? ` is-${tone}` : ""}`}>
      <div className="landing-container stack-loose">
        <div className="landing-section-head">
          <h2>{title}</h2>
          {sub && <p className="landing-section-sub">{sub}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

function CardGrid({ items, numbered = false }: { items: Item[]; numbered?: boolean }) {
  const List = numbered ? "ol" : "ul";
  return (
    <List className={`landing-grid${numbered ? " is-steps" : ""}`}>
      {items.map((it, i) => (
        <li key={it.title} className="landing-card">
          {numbered && <span className="landing-step-no">{i + 1}</span>}
          <h3>{it.title}</h3>
          {it.body && <p className="text-secondary">{it.body}</p>}
        </li>
      ))}
    </List>
  );
}

function FeatureBlock({ f }: { f: FeatureSection }) {
  return (
    <LandingSection id={f.id} title={f.title} sub={f.sub}>
      {f.chips && <ul className="landing-chips">{f.chips.map((c) => <li key={c}>{c}</li>)}</ul>}
      <CardGrid items={f.items} />
      {f.note && <p className="landing-note">{f.note}</p>}
      <LandingCta />
    </LandingSection>
  );
}

export function Problem() {
  return (
    <LandingSection title={PROBLEM.title} tone="subtle">
      <CardGrid items={PROBLEM.items} />
    </LandingSection>
  );
}

export function Features() {
  return (
    <div id="features">
      {FEATURES.map((f) => <FeatureBlock key={f.id} f={f} />)}
    </div>
  );
}

export function Process() {
  return (
    <LandingSection id="process" title={PROCESS.title} tone="subtle">
      <CardGrid items={PROCESS.steps} numbered />
    </LandingSection>
  );
}
