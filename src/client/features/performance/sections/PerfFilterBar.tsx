import { Button, FilterBar, Select, ButtonAnchor } from "../../../ui";
import { FORMAT_LABELS } from "../../../../shared/performance";
import type { Filters, PerfQuery } from "../perfTypes";

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
        <Select label="가이드" value={f.guideId} onChange={(e) => setF({ ...f, guideId: e.target.value })}>
          <option value="">전체</option>
          {filters.guides.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
      )}
      <Select label="인플루언서" value={f.influencerId} onChange={(e) => setF({ ...f, influencerId: e.target.value })}>
        <option value="">전체</option>
        {filters.influencers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </Select>
      <Select label="형식" value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>
        <option value="">전체</option>
        {Object.entries(FORMAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>
    </FilterBar>
  );
}
