import { FilterBar, Input, Select } from "../../../ui";
import { CONSENT_OPTIONS, SOURCE_OPTIONS, channelOptions, toOptions, type Option } from "../groupRules";
import type { Filters, Group } from "../useLeads";
import type { Lookups } from "../types";

type Props = { filters: Filters; onChange: (f: Filters) => void; lk: Lookups; groups: Group[] };

// 연락처 목록 위 검색과 9개 조건 필터. 좁은 화면에서는 FilterBar 가 두 칸씩 접는다
export function LeadFilters({ filters, onChange, lk, groups }: Props) {
  const select = (key: keyof Filters, label: string, options: Option[]) => (
    <Select aria-label={label} value={filters[key]} onChange={(e) => onChange({ ...filters, [key]: e.target.value })}>
      <option value="">{label} 전체</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
  return (
    <FilterBar label="리드 필터">
      <Input aria-label="검색" placeholder="이메일, 이름, 소속 검색" value={filters.q} onChange={(e) => onChange({ ...filters, q: e.target.value })} />
      {select("sourceType", "출처", SOURCE_OPTIONS)}
      {select("guideId", "가이드", toOptions(lk.guides))}
      {select("influencerId", "인플루언서", toOptions(lk.influencers))}
      {select("channelKey", "채널", channelOptions(lk))}
      {lk.contents.length > 0 && select("contentLinkId", "콘텐츠", toOptions(lk.contents))}
      {select("marketing", "마케팅 동의", CONSENT_OPTIONS)}
      {select("alimtalk", "알림톡 동의", CONSENT_OPTIONS)}
      {select("tagId", "태그", toOptions(lk.tags))}
      {select("groupId", "그룹", toOptions(groups))}
    </FilterBar>
  );
}
