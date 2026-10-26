import { Badge, ButtonLink, PageHeader, SectionCard } from "../../ui";

export function PlanPage() {
  return (
    <>
      <PageHeader title="요금제 · 크레딧" />
      <SectionCard title="현재 요금제" actions={<Badge tone="accent">Starter</Badge>}>
        <div className="stack">
          <p className="text-secondary">결제 연동은 준비 중이에요. 요금제를 바꾸고 싶으면 문의를 남겨 주세요.</p>
          <div className="row">
            <ButtonLink size="sm" to="/dashboard/help?type=plan">요금제 변경 문의하기</ButtonLink>
          </div>
        </div>
      </SectionCard>
    </>
  );
}
