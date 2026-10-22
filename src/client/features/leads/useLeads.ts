import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import type { GroupRules } from "../../../shared/leads";
import { EMPTY_LOOKUPS, type LeadRow, type Lookups } from "./types";

export type Group = { id: string; name: string; rules: GroupRules; count: number };
export type Filters = Record<"q" | "sourceType" | "guideId" | "influencerId" | "channelKey" | "marketing" | "alimtalk" | "tagId" | "groupId", string>;
export const NO_FILTERS: Filters = { q: "", sourceType: "", guideId: "", influencerId: "", channelKey: "", marketing: "", alimtalk: "", tagId: "", groupId: "" };
export type Act = (fn: () => Promise<unknown>, done: string) => Promise<void>;

// 리드 화면 데이터: 필터가 바뀌면 리드·조회값·그룹을 다시 불러온다
export function useLeads() {
  const toast = useToast();
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [lk, setLk] = useState<Lookups>(EMPTY_LOOKUPS);
  const [groups, setGroups] = useState<Group[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  const query = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString(), [filters]);
  const load = useCallback(async () => {
    const [r, g] = await Promise.all([api.get<{ leads: LeadRow[]; lookups: Lookups }>(`/leads?${query}`), api.get<{ groups: Group[] }>("/leads/groups")]);
    setLeads(r.leads);
    setLk(r.lookups);
    setGroups(g.groups);
  }, [query]);
  useEffect(() => {
    void load();
  }, [load]);

  // 변경 요청 뒤 성공 알림과 다시 불러오기를 한 번에 처리한다
  const act: Act = async (fn, done) => {
    try {
      await fn();
      toast(done, "success");
      await load();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  return { leads, lk, groups, filters, setFilters, query, load, act };
}
