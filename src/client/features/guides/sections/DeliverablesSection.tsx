import { Checkbox, Input, SectionCard } from "../../../ui";
import { csv, type GuideForm, type SetField } from "../useGuideForm";

export function DeliverablesSection({ form, set }: { form: GuideForm; set: SetField }) {
  const setDeliverables = (patch: Partial<GuideForm["deliverables"]>) => set("deliverables", { ...form.deliverables, ...patch });
  const setScope = (patch: Partial<GuideForm["secondaryUseScope"]>) => set("secondaryUseScope", { ...form.secondaryUseScope, ...patch });
  const scope = form.secondaryUseScope;
  return (
    <SectionCard title="산출물과 2차 활용 범위" description="인플루언서 동의 화면에 이 범위가 그대로 보여요.">
      <div className="stack">
        <div className="row row-wrap">
          <Checkbox label="완성본 (필수)" checked disabled />
          <Checkbox label="클린본 (자막·음악 없는 버전)" checked={form.deliverables.clean} onChange={(e) => setDeliverables({ clean: e.target.checked })} />
        </div>
        <Input label="산출물 메모" value={form.deliverables.note} onChange={(e) => setDeliverables({ note: e.target.value })} placeholder="예: 썸네일용 정지 컷 1장" />
        <Checkbox label="광고 집행에 쓸 수 있음" checked={scope.ads} onChange={(e) => setScope({ ads: e.target.checked })} />
        <div className="grid-3">
          <Input label="매체 (쉼표로 구분)" value={scope.media.join(", ")} onChange={(e) => setScope({ media: csv(e.target.value) })} placeholder="예: Meta, 유튜브" />
          <Input label="지역 (쉼표로 구분)" value={scope.regions.join(", ")} onChange={(e) => setScope({ regions: csv(e.target.value) })} placeholder="예: 한국, 미국" />
          <Input label="기간(개월)" type="number" min={0} max={120} value={scope.months} onChange={(e) => setScope({ months: Number(e.target.value) || 0 })} />
        </div>
      </div>
    </SectionCard>
  );
}
