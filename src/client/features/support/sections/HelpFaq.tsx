import { Disclosure, SectionCard } from "../../../ui";
import { HELP_FAQ } from "../faq";

// 자주 묻는 질문. 누르면 답이 펼쳐진다
export function HelpFaq() {
  return (
    <SectionCard title="자주 묻는 질문">
      <div>
        {HELP_FAQ.map((it) => (
          <Disclosure key={it.q} title={it.q}>
            <p className="text-secondary help-faq-answer">{it.a}</p>
          </Disclosure>
        ))}
      </div>
    </SectionCard>
  );
}
