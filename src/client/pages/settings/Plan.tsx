import { Badge, PageHeader, SectionCard } from "../../ui";

export function PlanPage() {
  return (
    <>
      <PageHeader title="요금제 · 크레딧" />
      <SectionCard title="현재 요금제" actions={<Badge tone="accent">Starter</Badge>}>
        <p className="text-secondary">결제 연동은 준비 중이에요. 요금제 변경이 필요하면 도움 받기로 문의해 주세요.</p>
      </SectionCard>
    </>
  );
}
