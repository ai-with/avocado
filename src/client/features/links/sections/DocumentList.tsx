import { useState } from "react";
import { Badge, Button, EmptyState, ButtonLink } from "../../../ui";
import { DOC_SOURCE_LABELS } from "../../../../shared/leads";
import { DocumentCard } from "../DocumentCard";
import { dateTime, docSize, documentStatsText, gateLabel, type Channel, type DocumentRow } from "../common";

type Props = { docs: DocumentRow[]; channels: Channel[]; onRemove: (d: DocumentRow) => void };

// /links '자료' 탭: 워크스페이스 전체 자료 카드
export function DocumentList({ docs, channels, onRemove }: Props) {
  const [statsFor, setStatsFor] = useState<string | null>(null);
  if (docs.length === 0) {
    return <EmptyState icon="file-text" title="만든 자료가 없어요" description="직접 쓴 글, PDF, 홈페이지 주소로 자료를 만들면 어느 인플루언서 영상에서 온 사람이 어디까지 읽었는지 볼 수 있어요." action={<ButtonLink to="/dashboard/documents/new">자료 만들기</ButtonLink>} />;
  }
  return (
    <div className="stack">
      {docs.map((d) => (
        <DocumentCard
          key={d.id}
          doc={d}
          channels={channels}
          heading={<div className="row row-tight"><Badge tone="info">{DOC_SOURCE_LABELS[d.sourceType]}</Badge><b>{d.title}</b></div>}
          meta={`${docSize(d)} · 정보 입력 ${gateLabel(d.gate)} · ${dateTime(d.createdAt)} 만듦 · ${documentStatsText(d.stats)}`}
          actions={
            <>
              <ButtonLink size="sm" to={`/dashboard/documents/${d.id}`}>편집·게이트</ButtonLink>
              <Button size="sm" variant="ghost" onClick={() => onRemove(d)}>삭제</Button>
            </>
          }
          statsOpen={statsFor === d.id}
          onToggleStats={() => setStatsFor(statsFor === d.id ? null : d.id)}
        />
      ))}
    </div>
  );
}
