import { SOURCE_TYPE_LABELS, type GroupCondition, type GroupField } from "../../../shared/leads";
import type { Lookups } from "./types";

export type Option = { value: string; label: string };

export const CONSENT_OPTIONS: Option[] = [{ value: "true", label: "동의" }, { value: "false", label: "동의 없음" }];
export const SOURCE_OPTIONS: Option[] = Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => ({ value, label }));
export const toOptions = (list: { id: string; name: string }[]): Option[] => list.map((x) => ({ value: x.id, label: x.name }));
export const channelOptions = (lk: Lookups): Option[] => lk.channels.map((c) => ({ value: c.key, label: c.name }));

export const FIELD_LABELS: Record<GroupField, string> = {
  guide_id: "가이드",
  influencer_id: "인플루언서",
  channel_key: "채널",
  source_type: "출처 유형",
  marketing_opt_in: "마케팅 동의",
  alimtalk_opt_in: "알림톡 동의",
  tag_id: "태그",
  created_after: "처음 들어온 날짜 이후",
};

export function valueOptions(field: GroupField, lk: Lookups): Option[] | null {
  switch (field) {
    case "guide_id":
      return toOptions(lk.guides);
    case "influencer_id":
      return toOptions(lk.influencers);
    case "channel_key":
      return channelOptions(lk);
    case "source_type":
      return SOURCE_OPTIONS;
    case "tag_id":
      return toOptions(lk.tags);
    case "marketing_opt_in":
    case "alimtalk_opt_in":
      return CONSENT_OPTIONS;
    case "created_after":
      return null;
  }
}

export function describe(c: GroupCondition, lk: Lookups): string {
  const v = c.field === "created_after" ? new Date(Number(c.value)).toLocaleDateString("ko-KR") : (valueOptions(c.field, lk)?.find((o) => o.value === String(c.value))?.label ?? String(c.value));
  return `${FIELD_LABELS[c.field]} ${c.op === "eq" ? "=" : "≠"} ${v}`;
}
