import { Button, Card } from "../../../ui";
import type { DocumentGate } from "../../../../shared/leads";
import type { DocumentDetail } from "../../links/common";
import { GateTimingField } from "../GateTimingField";

type Props = { doc: DocumentDetail; gate: DocumentGate; onChange: (patch: Partial<DocumentGate>) => void; onPreview: () => void; onSettings: () => void };

// 편집 화면 오른쪽: 정보 입력 다이얼로그 노출 시점과 미리보기
export function GatePanel({ doc, gate, onChange, onPreview, onSettings }: Props) {
  const unfetchedUrl = doc.sourceType === "url" && !doc.fetchedHtmlKey;
  return (
    <Card className="stack doc-gate-panel">
      <h4>정보 입력 다이얼로그</h4>
      <GateTimingField gate={gate} onChange={onChange} />
      {unfetchedUrl && gate.position === "scroll" && gate.scrollPct > 0 && <p className="text-caption">불러오지 못한 주소라 지금은 열자마자 물어요.</p>}
      <div className="row row-wrap">
        <Button size="sm" variant="secondary" onClick={onPreview}>읽는 사람 화면 미리보기</Button>
        <Button size="sm" variant="ghost" onClick={onSettings}>받을 항목·질문 설정</Button>
      </div>
    </Card>
  );
}
