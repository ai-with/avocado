import { SectionCard } from "../../../ui";
import { HELP_FAQ } from "../faq";

// 자주 묻는 질문. 누르면 답이 펼쳐진다
export function HelpFaq() {
  return (
    <SectionCard title="자주 묻는 질문">
      <div className="help-faq">
        {HELP_FAQ.map((it) => (
          <details key={it.q} className="help-faq-item">
            <summary>{it.q}</summary>
            <p className="text-secondary">{it.a}</p>
          </details>
        ))}
      </div>
    </SectionCard>
  );
}
