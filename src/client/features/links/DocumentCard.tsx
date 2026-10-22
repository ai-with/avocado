import type { ReactNode } from "react";
import { Button, Card } from "../../ui";
import { DocumentAnalytics } from "./DocumentPanel";
import type { Channel, DocumentRow } from "./common";

type Props = {
  doc: DocumentRow;
  channels: Channel[];
  heading: ReactNode;
  meta: ReactNode;
  actions: ReactNode;
  statsOpen: boolean;
  onToggleStats: () => void;
};

// 자료 한 건 카드: 제목, 요약, 동작 버튼, 펼치는 열람 분석
export function DocumentCard({ doc, channels, heading, meta, actions, statsOpen, onToggleStats }: Props) {
  return (
    <Card className="stack">
      <div className="row row-between row-wrap">
        <div className="stack-tight">
          {heading}
          <div className="text-caption">{meta}</div>
        </div>
        <div className="row row-wrap">
          {actions}
          <Button size="sm" variant="ghost" onClick={onToggleStats} aria-expanded={statsOpen}>{statsOpen ? "분석 닫기" : "열람 분석 보기"}</Button>
        </div>
      </div>
      {statsOpen && <DocumentAnalytics doc={doc} channels={channels} />}
    </Card>
  );
}
