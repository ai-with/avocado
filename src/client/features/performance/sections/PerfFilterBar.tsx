import { Button, FilterBar, Select, ButtonAnchor, SelectMenu } from "../../../ui";
import { FORMAT_LABELS } from "../../../../shared/performance";
import type { Filters, PerfQuery } from "../perfTypes";

const ALL = { value: "", label: "전체" };

type Props = { f: PerfQuery; setF: (f: PerfQuery) => void; filters: Filters; qs: string; showGuide: boolean };

// 성과표 위 필터 줄. 가이드 상세 탭에서는 가이드 필터를 숨긴다
export function PerfFilterBar({ f, setF, filters, qs, showGuide }: Props) {
  const actions = (
    <>
      <ButtonAnchor className="perf-export" href={`/api/performance/export${qs ? `?${qs}` : ""}`} download>CSV 내보내기</ButtonAnchor>
      <Button variant="ghost" disabled title="2단계에서 제공해요">구글 시트 (준비 중)</Button>
    </>
  );
  return (
    <FilterBar label="성과표 필터" actions={actions}>
      {showGuide && (
        <SelectMenu label="가이드" options={[ALL, ...filters.guides.map((g) => ({ value: g.id, label: g.name }))]} value={f.guideId} onChange={(v) => setF({ ...f, guideId: v ?? "" })} />
      )}
      <SelectMenu label="인플루언서" options={[ALL, ...filters.influencers.map((i) => ({ value: i.id, label: i.name }))]} value={f.influencerId} onChange={(v) => setF({ ...f, influencerId: v ?? "" })} />
      <Select label="형식" value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>
        <option value="">전체</option>
        {Object.entries(FORMAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>
    </FilterBar>
  );
}
