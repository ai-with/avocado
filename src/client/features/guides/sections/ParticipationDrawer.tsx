import { Badge, Button, Drawer, SectionCard } from "../../../ui";
import { STATUS_LABEL } from "../../../../shared/participation";
import { handlesText } from "../InfluencersPage";
import { STATUS_TONE } from "../participation";
import type { GuideInfluencerRow } from "../types";
import { ContractForm, TermsForm, VarsForm } from "./ParticipationForms";
import { ContactTimeline } from "./ContactTimeline";

type Props = { row: GuideInfluencerRow; base: string; canEdit: boolean; reloadKey: number; onSaved: () => Promise<void>; onMessage: (r: GuideInfluencerRow) => void; onClose: () => void };

// 캠페인 인플루언서 한 줄 상세: 조건·계약 기간 편집, 이 캠페인의 소통 이력 (TASK-072)
export function ParticipationDrawer({ row, base, canEdit, reloadKey, onSaved, onMessage, onClose }: Props) {
  const path = `${base}/${row.id}`;
  const description = (
    <span className="row row-tight row-wrap">
      <Badge tone={STATUS_TONE[row.participationStatus]}>{STATUS_LABEL[row.participationStatus]}</Badge>
      <Badge>{row.round}회차</Badge>
      <span>{handlesText(row.influencer)}</span>
    </span>
  );
  return (
    <Drawer title={row.influencer.displayName} description={description} onClose={onClose}>
      <div className="stack-loose">
        <SectionCard title="조건" description="인플루언서마다 다르게 저장해요.">
          <TermsForm key={row.id} path={path} terms={row.terms} canEdit={canEdit} onSaved={onSaved} />
        </SectionCard>
        <SectionCard title="계약 기간">
          <ContractForm key={row.id} row={row} canEdit={canEdit} onSaved={onSaved} />
        </SectionCard>
        <SectionCard title="메시지 변수 값" description="템플릿의 사용자 변수에 이 인플루언서만의 값을 넣어요. 비우면 기본값을 써요.">
          <VarsForm key={row.id} path={path} terms={row.terms} canEdit={canEdit} onSaved={onSaved} />
        </SectionCard>
        <SectionCard
          title="소통 이력"
          description="이 캠페인에서 있었던 일을 시간순으로 보여 줘요."
          actions={canEdit && <Button size="sm" variant="secondary" onClick={() => onMessage(row)}>메시지 보내기</Button>}
        >
          <ContactTimeline path={path} canEdit={canEdit} reloadKey={reloadKey} />
        </SectionCard>
      </div>
    </Drawer>
  );
}
