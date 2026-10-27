import { Button, Modal } from "../../../ui";
import type { GuideResponse } from "../types";
import { LangCopyButton } from "./LangCopyButton";

type Props = { data: GuideResponse; onEmail: () => void; onClose: () => void };

// 공개 직후 보내기 방법 고르기 (AIWITH-371·372): 링크 복사 / 이메일 보내기 / 나중에
export function SendGuideModal({ data, onEmail, onClose }: Props) {
  return (
    <Modal
      open
      title="인플루언서에게 어떻게 보낼까요?"
      description="가이드를 공개했어요. 보낼 방법을 하나 골라 주세요."
      onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose} data-autofocus>나중에</Button>}
    >
      <div className="stack-loose">
        <div className="stack-tight">
          <p className="guide-subhead">링크 복사</p>
          <p className="text-secondary">DM으로 보내면 인플루언서가 이름과 계정을 넣고 시작해요. 인플루언서가 볼 언어를 골라 주세요.</p>
          <div><LangCopyButton url={data.sharedUrl} defaultLang={data.guide.lang} label="링크 복사" size="md" /></div>
        </div>
        <div className="stack-tight">
          <p className="guide-subhead">이메일 보내기</p>
          <p className="text-secondary">인플루언서를 추가하면 사람마다 링크가 생기고, 이메일로 바로 보낼 수 있어요. 누가 열었는지도 알 수 있어요.</p>
          <div><Button variant="secondary" onClick={onEmail}>인플루언서 추가하기</Button></div>
        </div>
      </div>
    </Modal>
  );
}
