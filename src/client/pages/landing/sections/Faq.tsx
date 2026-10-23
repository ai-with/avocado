import { FAQ } from "../copy";
import { LandingSection } from "./Features";

export function Faq() {
  return (
    <LandingSection id="faq" title={FAQ.title}>
      <div className="landing-faq">
        {FAQ.items.map((it) => (
          <details key={it.q} className="landing-faq-item">
            <summary>{it.q}</summary>
            <p className="text-secondary">{it.a}</p>
          </details>
        ))}
      </div>
    </LandingSection>
  );
}
