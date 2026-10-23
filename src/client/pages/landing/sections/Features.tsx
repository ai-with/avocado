import type { ReactNode } from "react";
import { FEATURES, PROBLEM, PROCESS, type FeatureSection, type Item } from "../copy";
import { DEMOS, type FeatureId } from "../demos";

type SectionProps = { id?: string; title: string; sub?: string; children: ReactNode; tone?: "subtle" };

// 랜딩 섹션 공통 틀: h2 + 부제 + 본문
export function LandingSection({ id, title, sub, children, tone }: SectionProps) {
  return (
    <section id={id} className={`landing-section${tone ? ` is-${tone}` : ""}`}>
      <div className="landing-container stack-loose">
        <SectionHead title={title} sub={sub} />
        {children}
      </div>
    </section>
  );
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="landing-section-head">
      <h2>{title}</h2>
      {sub && <p className="landing-section-sub">{sub}</p>}
    </div>
  );
}

type CardGridProps = { items: Item[]; numbered?: boolean; compact?: boolean };

// compact: 데모 옆에 세로로 쌓는 작은 리스트형
function CardGrid({ items, numbered = false, compact = false }: CardGridProps) {
  const List = numbered ? "ol" : "ul";
  const variant = numbered ? " is-steps" : compact ? " is-compact" : "";
  return (
    <List className={`landing-grid${variant}`}>
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

// 데스크톱 2열: 텍스트 + 인터랙션 데모. 블록마다 데모 쪽을 번갈아 둔다(flipped면 데모가 왼쪽)
function FeatureBlock({ f, flipped }: { f: FeatureSection; flipped: boolean }) {
  const Demo = DEMOS[f.id as FeatureId];
  const layout = Demo ? ` has-demo${flipped ? " is-flipped" : ""}` : "";
  return (
    <section id={f.id} className="landing-section">
      <div className={`landing-container landing-feature${layout}`}>
        <div className="landing-feature-text stack-loose">
          <SectionHead title={f.title} sub={f.sub} />
          {f.chips && <ul className="landing-chips">{f.chips.map((c) => <li key={c}>{c}</li>)}</ul>}
          <CardGrid items={f.items} compact={Boolean(Demo)} />
          {f.note && <p className="landing-note">{f.note}</p>}
        </div>
        {Demo && <div className="landing-feature-demo"><Demo /></div>}
      </div>
    </section>
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
      {FEATURES.map((f, i) => <FeatureBlock key={f.id} f={f} flipped={i % 2 === 1} />)}
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
