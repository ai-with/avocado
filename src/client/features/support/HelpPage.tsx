import { PageHeader } from "../../ui";
import { useSupport } from "./useSupport";
import { SupportForm } from "./sections/SupportForm";
import { SupportHistory } from "./sections/SupportHistory";
import { HelpFaq } from "./sections/HelpFaq";
import "./support.css";

// /dashboard/help: 문의 남기기, 내가 보낸 문의, 자주 묻는 질문 (AIWITH-445)
export function HelpPage() {
  const s = useSupport();
  return (
    <>
      <PageHeader title="도움 받기" description="사용하다 막히거나 요금제를 바꾸고 싶으면 여기로 알려 주세요." />
      <div className="stack-loose content-narrow">
        <SupportForm s={s} />
        <SupportHistory requests={s.requests} />
        <HelpFaq />
      </div>
    </>
  );
}
