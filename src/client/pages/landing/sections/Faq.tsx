import { Disclosure } from "../../../ui";
import { FAQ } from "../copy";
import { LandingSection } from "./Features";

export function Faq() {
  return (
    <LandingSection id="faq" title={FAQ.title}>
      <div className="landing-faq">
        {FAQ.items.map((it) => (
          <Disclosure key={it.q} title={it.q}>
            <p className="text-secondary">{it.a}</p>
          </Disclosure>
        ))}
      </div>
    </LandingSection>
  );
}
