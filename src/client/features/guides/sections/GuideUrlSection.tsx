import { Badge, CopyButton, Input, SectionCard } from "../../../ui";
import type { GuideResponse } from "../types";

export function GuideUrlSection({ data }: { data: GuideResponse }) {
  const { guide, sharedUrl, warnings } = data;
  const published = guide.status === "published";
  const title = (
    <span className="row">
      가이드 URL
      <Badge tone={published ? "success" : "neutral"}>{published ? "공개" : "작성 중"}</Badge>
      {guide.videoGuide?.draft && <Badge tone="warn">초안</Badge>}
    </span>
  );
  return (
    <SectionCard title={title}>
      <div className="stack">
        {published ? (
          <>
            <div className="row url-row">
              <Input aria-label="가이드 공용 URL" value={sharedUrl} readOnly onFocus={(e) => e.target.select()} />
              <CopyButton text={sharedUrl} label="링크 복사" size="md" />
            </div>
            <SendHow />
          </>
        ) : (
          <p className="text-secondary">공개하면 바로 공유할 수 있는 URL이 나와요. 공개 전에는 인플루언서가 열 수 없어요.</p>
        )}
        {warnings.length > 0 && <p className="text-caption">규정 경고 {warnings.length}건: 편집 화면에서 확인하세요.</p>}
      </div>
    </SectionCard>
  );
}

function SendHow() {
  return (
    <div className="send-how">
      <strong>인플루언서에게 어떻게 보낼까요?</strong>
      <ul className="plain-list">
        <li>위 공용 링크를 DM으로 보내면 인플루언서가 이름과 계정을 넣고 시작해요.</li>
        <li>누가 열었는지 정확히 보려면 아래 인플루언서 탭에서 사람마다 링크를 복사하거나 이메일로 보내세요.</li>
      </ul>
      <p className="text-caption">링크가 다른 사람에게 전달되면 열람 기록이 섞일 수 있어요.</p>
    </div>
  );
}
