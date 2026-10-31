import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import type { GroupRules } from "../../../shared/leads";
import { EMPTY_LOOKUPS, type LeadRow, type Lookups } from "./types";

export type Group = { id: string; name: string; rules: GroupRules; count: number };
export type Filters = Record<"q" | "sourceType" | "guideId" | "influencerId" | "channelKey" | "marketing" | "alimtalk" | "tagId" | "groupId" | "contentLinkId", string>;
export const NO_FILTERS: Filters = { q: "", sourceType: "", guideId: "", influencerId: "", channelKey: "", marketing: "", alimtalk: "", tagId: "", groupId: "", contentLinkId: "" };
export type Act = (fn: () => Promise<unknown>, done: string) => Promise<void>;

// 리드 화면 데이터: 필터가 바뀌면 리드·조회값·그룹을 다시 불러온다
export function useLeads(initial: Partial<Filters> = {}, includeGroups = true) {
  const toast = useToast();
  const { me } = useMe(), workspaceKey = me?.workspace?.id ?? "", currentWorkspace = useRef(workspaceKey);
  currentWorkspace.current = workspaceKey;
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [lk, setLk] = useState<Lookups>(EMPTY_LOOKUPS);
  const [groups, setGroups] = useState<Group[]>([]);
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => ({ ...(initial.guideId !== undefined ? NO_FILTERS : Object.fromEntries(Object.keys(NO_FILTERS).map((key) => [key, params.get(key) ?? ""]))), ...initial }) as Filters);

  const query = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString(), [filters]);
  const [history, setHistory] = useState<(string | null)[]>([null]), [nextCursor, setNext] = useState<string | null>(null), [lookupCursors, setLookupCursors] = useState<Partial<Record<keyof Lookups, string | null>>>({}), [groupCursor, setGroupCursor] = useState<string | null>(null);
  const [error, setError] = useState(""), [groupError, setGroupError] = useState(""), [groupsLoading, setGroupsLoading] = useState(true);
  const cursor = history.at(-1), pageKey = `${workspaceKey}|${query}|${cursor ?? ""}`, current = useRef(pageKey), requests = useRef(0), moreBusy = useRef(false), mounted = useRef(true);
  current.current = pageKey;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setHistory([null]); setLk(EMPTY_LOOKUPS); setGroups([]); }, [workspaceKey]);
  useEffect(() => { if (initial.guideId !== undefined) { setFilters((old) => old.guideId === initial.guideId ? old : { ...NO_FILTERS, guideId: initial.guideId! }); setHistory([null]); } }, [initial.guideId]);
  const loadRows = useCallback(async () => {
    const request = ++requests.current; setLeads(null); setError("");
    try {
      const suffix = new URLSearchParams(query); if (cursor) suffix.set("cursor", cursor);
      const r = await api.get<{ leads: LeadRow[]; lookups: Lookups; nextCursor?: string | null; lookupCursors?: Partial<Record<keyof Lookups, string | null>> }>(`/leads?${suffix}`);
      if (mounted.current && current.current === pageKey && request === requests.current) { setLeads(r.leads); setLk(r.lookups); setNext(r.nextCursor ?? null); setLookupCursors(r.lookupCursors ?? {}); }
    } catch (cause) { if (mounted.current && current.current === pageKey && request === requests.current) setError(errorMessage(cause)); }
  }, [query, cursor, pageKey]);
  const loadGroups = useCallback(async () => {
    if (!includeGroups) { setGroupsLoading(false); return; }
    setGroupsLoading(true); setGroupError("");
    try { const r = await api.get<{ groups: Group[]; nextCursor?: string | null }>("/leads/groups"); if (mounted.current && currentWorkspace.current === workspaceKey) { setGroups(r.groups); setGroupCursor(r.nextCursor ?? null); } }
    catch (cause) { if (mounted.current && currentWorkspace.current === workspaceKey) setGroupError(errorMessage(cause)); } finally { if (mounted.current && currentWorkspace.current === workspaceKey) setGroupsLoading(false); }
  }, [workspaceKey, includeGroups]);
  useEffect(() => { void loadRows(); }, [loadRows]);
  useEffect(() => { void loadGroups(); }, [loadGroups]);
  useEffect(() => {
    if (!filters.groupId || groupsLoading || groups.some((g) => g.id === filters.groupId)) return;
    let active = true; void api.get<{ group: Group }>(`/leads/groups/${encodeURIComponent(filters.groupId)}`).then((r) => { if (active && mounted.current && currentWorkspace.current === workspaceKey) setGroups((old) => [...old.filter((g) => g.id !== r.group.id), r.group]); }, () => {});
    return () => { active = false; };
  }, [filters.groupId, groups, groupsLoading, workspaceKey]);
  const moreGroups = async () => {
    if (!groupCursor || moreBusy.current) return; moreBusy.current = true;
    try { const r = await api.get<{ groups: Group[]; nextCursor?: string | null }>(`/leads/groups?cursor=${encodeURIComponent(groupCursor)}`); if (mounted.current && currentWorkspace.current === workspaceKey) { setGroups((old) => [...new Map([...old, ...r.groups].map((g) => [g.id, g])).values()]); setGroupCursor(r.nextCursor ?? null); } }
    catch (cause) { if (mounted.current && currentWorkspace.current === workspaceKey) toast(errorMessage(cause), "danger"); } finally { moreBusy.current = false; }
  };
  const moreLookup = async (kind: keyof Lookups) => {
    if (!lookupCursors[kind] || moreBusy.current) return; moreBusy.current = true; const owner = pageKey;
    try {
      const r = await api.get<{ items: { id: string; name: string; label?: string }[]; nextCursor?: string | null }>(`/leads/lookups?kind=${kind}&cursor=${encodeURIComponent(lookupCursors[kind]!)}`);
      if (mounted.current && current.current === owner) {
        setLk((old) => kind === "channels" ? { ...old, channels: [...new Map([...old.channels, ...r.items.map((item) => ({ key: item.id, name: item.name }))].map((item) => [item.key, item])).values()] } : { ...old, [kind]: [...new Map([...(old[kind] as { id: string; name: string }[]), ...r.items].map((item) => [item.id, item])).values()] });
        setLookupCursors((old) => ({ ...old, [kind]: r.nextCursor ?? null }));
      }
    } catch (cause) { toast(errorMessage(cause), "danger"); } finally { moreBusy.current = false; }
  };
  const load = async () => { await Promise.all([loadRows(), loadGroups()]); };

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
  return { leads, lk, groups, filters, setFilters: (value: Filters) => { setFilters(value); setHistory([null]); }, query, load, act, error, groupError, groupsLoading, moreLookup, lookupCursors, moreGroups, groupCursor,
    pageKey, page: history.length, hasPrevious: history.length > 1, hasNext: !!nextCursor, nextPage: () => { if (nextCursor) setHistory((old) => [...old, nextCursor]); }, previousPage: () => setHistory((old) => old.length > 1 ? old.slice(0, -1) : old) };
}
