import { useState } from "react";
import { Button, Card, EmptyState, LoadingState, SelectMenu } from "../../../ui";
import { api } from "../../../lib/api";
import { ZERO_HINT } from "../../links/common";
import { LeadsTable } from "../common";
import { NO_FILTERS, type Act, type Filters, type Group } from "../useLeads";
import type { LeadRow, Lookups } from "../types";
import { LeadFilters } from "./LeadFilters";

type Props = {
  leads: LeadRow[] | null;
  lk: Lookups;
  groups: Group[];
  filters: Filters;
  onFilters: (f: Filters) => void;
  selected: Set<string>;
  onSelect: (ids: Set<string>) => void;
  onOpen: (id: string) => void;
  act: Act;
};

export function ContactsTab({ leads, lk, groups, filters, onFilters, selected, onSelect, onOpen, act }: Props) {
  return (
    <div className="stack">
      <LeadFilters filters={filters} onChange={onFilters} lk={lk} groups={groups} />
      {selected.size > 0 && <BulkTagBar lk={lk} selected={selected} onSelect={onSelect} act={act} />}
      <LeadList leads={leads} lk={lk} filters={filters} onFilters={onFilters} selected={selected} onSelect={onSelect} onOpen={onOpen} />
    </div>
  );
}

function LeadList({ leads, lk, filters, onFilters, selected, onSelect, onOpen }: Omit<Props, "groups" | "act">) {
  if (!leads) return <LoadingState pattern="table" />;
  if (leads.length > 0) return <LeadsTable leads={leads} lk={lk} selected={selected} onSelect={onSelect} onOpen={onOpen} />;
  if (Object.values(filters).some(Boolean)) {
    return <EmptyState title="조건에 맞는 리드가 없어요" description="필터를 지우거나 다른 조건으로 찾아 보세요." action={<Button variant="secondary" onClick={() => onFilters(NO_FILTERS)}>필터 지우기</Button>} />;
  }
  return <EmptyState title="아직 리드가 없어요" description={`${ZERO_HINT}. 자료 게이트나 신청 폼으로 이메일을 받으면 여기에 모여요.`} />;
}

// 고른 사람들에게 태그를 한 번에 붙인다
function BulkTagBar({ lk, selected, onSelect, act }: Pick<Props, "lk" | "selected" | "onSelect" | "act">) {
  const [tagPick, setTagPick] = useState("");
  const attach = () => void act(() => api.post(`/leads/tags/${tagPick}/attach`, { leadIds: [...selected] }), "태그를 붙였어요.").then(() => onSelect(new Set()));
  return (
    <Card className="row row-wrap">
      <span>{selected.size}명 선택</span>
      <div className="lead-bulk-select">
        <SelectMenu aria-label="붙일 태그" placeholder="태그 고르기" options={lk.tags.map((t) => ({ value: t.id, label: t.name }))} value={tagPick || null} onChange={(v) => setTagPick(v ?? "")} />
      </div>
      <Button size="sm" disabled={!tagPick} onClick={attach}>태그 붙이기</Button>
    </Card>
  );
}
