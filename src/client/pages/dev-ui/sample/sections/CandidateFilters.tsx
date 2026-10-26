import { FilterBar, Input, Select } from "../../../../ui";
import { STATUS_LABEL, type CandidateStatus } from "../useSampleCandidates";

type Props = {
  query: string;
  onQuery: (v: string) => void;
  status: CandidateStatus | "";
  onStatus: (v: CandidateStatus | "") => void;
};

const STATUSES = Object.keys(STATUS_LABEL) as CandidateStatus[];

export function CandidateFilters({ query, onQuery, status, onStatus }: Props) {
  return (
    <FilterBar label="후보 목록 필터">
      <Input type="search" aria-label="이름이나 핸들로 찾기" placeholder="이름이나 핸들로 찾기" value={query} onChange={(e) => onQuery(e.target.value)} />
      <Select aria-label="상태" value={status} onChange={(e) => onStatus(e.target.value as CandidateStatus | "")}>
        <option value="">모든 상태</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
        ))}
      </Select>
    </FilterBar>
  );
}
