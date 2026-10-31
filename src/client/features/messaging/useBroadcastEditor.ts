import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import { dateTime } from "../links/common";
import { allPassed, validateTemplate, type Audience } from "../../../shared/messaging";
import { NEW, type Broadcast, type Count, type Draft, type Group, type Named } from "./broadcast-model";
import { messageHeaders, useMessageAvailability } from "./message-availability";

const COUNT_DEBOUNCE_MS = 300;
const AUTOSAVE_DEBOUNCE_MS = 5000;

function useAudienceOptions(audience: Audience) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [tags, setTags] = useState<Named[]>([]);
  const [groupCursor, setGroupCursor] = useState<string | null>(null), [tagCursor, setTagCursor] = useState<string | null>(null), [optionsError, setOptionsError] = useState(""), [optionsLoading, setOptionsLoading] = useState(true);
  const [groupsChecking, setGroupsChecking] = useState(false), [tagsChecking, setTagsChecking] = useState(false);
  const { me } = useMe(), workspace = me?.workspace?.id ?? "", current = useRef(workspace), alive = useRef(true), busy = useRef(false); current.current = workspace;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const merge = <T extends Named>(old: T[], items: T[]) => { const fresh = items.filter((r) => !old.some((existing) => existing.id === r.id)); return fresh.length ? [...old, ...fresh] : old; };
  const refreshOptions = useCallback(async () => {
    setOptionsLoading(true); setOptionsError(""); setGroups([]); setTags([]);
    try {
      const [g, t] = await Promise.all([api.get<{ groups: Group[]; nextCursor?: string | null }>("/leads/groups"), api.get<{ items: Named[]; nextCursor?: string | null }>("/leads/lookups?kind=tags")]);
      if (alive.current && current.current === workspace) { setGroups(g.groups); setTags(t.items); setGroupCursor(g.nextCursor ?? null); setTagCursor(t.nextCursor ?? null); }
    } catch (cause) { if (alive.current && current.current === workspace) setOptionsError(errorMessage(cause)); }
    finally { if (alive.current && current.current === workspace) setOptionsLoading(false); }
  }, [workspace]);
  useEffect(() => { void refreshOptions(); }, [refreshOptions]);
  const groupKey = JSON.stringify(audience.groupIds), tagKey = JSON.stringify(audience.tagIds);
  useEffect(() => {
    const missing = audience.groupIds.filter((id) => !groups.some((g) => g.id === id)); if (optionsLoading || !missing.length || optionsError) { setGroupsChecking(false); return; }
    setGroupsChecking(true); let active = true; void api.get<{ groups: Group[] }>(`/leads/groups/selected?ids=${encodeURIComponent(JSON.stringify(missing))}`).then((r) => { if (active && alive.current && current.current === workspace) setGroups((old) => merge(old, r.groups)); }, (cause: unknown) => { if (active && alive.current && current.current === workspace) setOptionsError(errorMessage(cause)); }).finally(() => { if (active && alive.current && current.current === workspace) setGroupsChecking(false); });
    return () => { active = false; };
  }, [groupKey, groups, optionsLoading, optionsError, workspace]);
  useEffect(() => {
    const missing = audience.tagIds.filter((id) => !tags.some((t) => t.id === id)); if (optionsLoading || !missing.length || optionsError) { setTagsChecking(false); return; }
    setTagsChecking(true); let active = true; void api.get<{ items: Named[] }>(`/leads/lookups?kind=tags&selected=${encodeURIComponent(JSON.stringify(missing))}`).then((r) => { if (active && alive.current && current.current === workspace) setTags((old) => merge(old, r.items)); }, (cause: unknown) => { if (active && alive.current && current.current === workspace) setOptionsError(errorMessage(cause)); }).finally(() => { if (active && alive.current && current.current === workspace) setTagsChecking(false); });
    return () => { active = false; };
  }, [tagKey, tags, optionsLoading, optionsError, workspace]);
  const more = async (kind: "groups" | "tags") => {
    const cursor = kind === "groups" ? groupCursor : tagCursor; if (!cursor || busy.current) return; busy.current = true;
    try {
      if (kind === "groups") { const r = await api.get<{ groups: Group[]; nextCursor?: string | null }>(`/leads/groups?cursor=${encodeURIComponent(cursor)}`); if (alive.current && current.current === workspace) { setGroups((old) => merge(old, r.groups)); setGroupCursor(r.nextCursor ?? null); } }
      else { const r = await api.get<{ items: Named[]; nextCursor?: string | null }>(`/leads/lookups?kind=tags&cursor=${encodeURIComponent(cursor)}`); if (alive.current && current.current === workspace) { setTags((old) => merge(old, r.items)); setTagCursor(r.nextCursor ?? null); } }
    } catch (cause) { if (alive.current && current.current === workspace) setOptionsError(errorMessage(cause)); } finally { busy.current = false; }
  };
  return { groups, tags, groupCursor, tagCursor, more, optionsError, optionsLoading: optionsLoading || groupsChecking || tagsChecking, refreshOptions, optionsIncomplete: audience.groupIds.some((id) => !groups.some((g) => g.id === id)) || audience.tagIds.some((id) => !tags.some((t) => t.id === id)) };
}

// 받는 사람 실시간 집계
function useAudienceCount(d: Draft) {
  const [count, setCount] = useState<Count | null>(null);
  const [countError, setCountError] = useState(""), [revision, setRevision] = useState(0), { me } = useMe();
  useEffect(() => {
    let active = true; setCount(null); setCountError("");
    const t = setTimeout(() => void api.post<Count>("/broadcasts/audience", { audience: d.audience, channel: d.channel, kind: d.kind }).then((r) => { if (active) setCount(r); }, (cause: unknown) => { if (active) setCountError(errorMessage(cause)); }), COUNT_DEBOUNCE_MS);
    return () => { active = false; clearTimeout(t); };
  }, [d.audience, d.channel, d.kind, me?.workspace?.id, revision]);
  return { count, countError, retryCount: () => setRevision((old) => old + 1) };
}

// 자동 임시저장 (5초 디바운스). 첫 저장에서 초안을 만든다
function useDraft(initial: Broadcast | null, locked: boolean) {
  const toast = useToast();
  const [id, setId] = useState(initial?.id ?? null);
  const idRef = useRef(id), generation = useRef(initial?.generation ?? ""), scope = useRef(useMe().me?.workspace?.id ?? "");
  const saving = useRef<Promise<string> | null>(null);
  const [d, setD] = useState<Draft>(initial ?? NEW);
  const [savedAt, setSavedAt] = useState<number | null>(initial?.updatedAt ?? null);
  const dirty = useRef(false);
  const set = (patch: Partial<Draft>) => ((dirty.current = true), setD((p) => ({ ...p, ...patch })));
  const save = (): Promise<string> => {
    if (saving.current) return saving.current;
    const task = (async () => {
      const headers = await messageHeaders(scope.current);
      dirty.current = false;
      if (idRef.current) {
        const r = await api.patch<{ updatedAt: number; generation: string }>(`/broadcasts/${idRef.current}`, { ...d, expectedGeneration: generation.current }, { headers });
        generation.current = r.generation; setSavedAt(r.updatedAt); return idRef.current;
      }
      const r = await api.post<{ broadcast: Broadcast }>("/broadcasts", d, { headers });
      idRef.current = r.broadcast.id; generation.current = r.broadcast.generation ?? ""; setId(r.broadcast.id); setSavedAt(r.broadcast.updatedAt); return r.broadcast.id;
    })().catch((error: unknown) => { dirty.current = true; throw error; }).finally(() => { saving.current = null; });
    saving.current = task; return task;
  };
  useEffect(() => {
    if (locked || !dirty.current) return;
    const t = setTimeout(() => void save().catch((e: unknown) => toast(errorMessage(e), "danger")), AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [d]);
  return { d, set, savedAt, save, isDirty: () => dirty.current, generation: () => generation.current, workspaceId: scope.current };
}

export function useBroadcastEditor(initial: Broadcast | null, connected: boolean, onDone: () => void) {
  const [pendingSend, setPendingSend] = useState(false);
  const locked = !!initial && initial.status !== "draft" || pendingSend;
  const availability = useMessageAvailability();
  const draft = useDraft(initial, locked);
  const { d, set } = draft;
  const countState = useAudienceCount(d), { count } = countState;
  const options = useAudienceOptions(d.audience);
  const [scheduleAt, setScheduleAt] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => setConfirmOpen(false), [d.audience, d.channel, d.kind]);
  const hasAudience = d.audience.groupIds.length + d.audience.tagIds.length > 0;
  const checks = validateTemplate({ channel: d.channel, kind: d.kind, template: d.template, hasTarget: hasAudience, alimtalkConnected: connected, senderReady: true });
  const toggleAudience = (key: keyof Audience, value: string) => {
    const cur = d.audience[key];
    set({ audience: { ...d.audience, [key]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] } });
  };
  const actions = useBroadcastActions(draft.save, draft.generation, draft.workspaceId, initial, scheduleAt, onDone, () => setConfirmOpen(false), () => setPendingSend(true));
  const leave = () => (draft.isDirty() && !locked ? void draft.save().then(onDone) : onDone());
  return {
    ...draft, ...actions, ...options, ...countState, locked, hasAudience, checks, toggleAudience, leave,
    scheduleAt, setScheduleAt, confirmOpen, setConfirmOpen,
    blockedAlimtalk: d.channel === "alimtalk" && !connected, availability, pendingSend,
    canSend: availability.available && !locked && !options.optionsError && !options.optionsLoading && !options.optionsIncomplete && allPassed(checks) && (count?.eligible ?? 0) > 0,
  };
}

function useBroadcastActions(save: () => Promise<string>, generation: () => string, workspace: string, initial: Broadcast | null, scheduleAt: string, onDone: () => void, closeConfirm: () => void, onIntent: () => void) {
  const toast = useToast();
  const busy = useRef(false), intent = useRef<{ bid: string; generation: string; requestId: string; scheduledAt: number | null } | null>(null);
  const test = async () => {
    try {
      const bid = await save();
      const r = await api.post<{ to: string; delivered: boolean }>(`/broadcasts/${bid}/test`, {}, { headers: await messageHeaders(workspace) });
      toast(r.delivered ? `${r.to} 주소로만 보냈어요. 리드 발송 기록에는 남지 않아요.` : "이메일 발송 설정이 없어 실제로 보내지는 않았어요. 리드 기록에는 남지 않아요.", r.delivered ? "success" : "neutral");
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  const send = async () => {
    if (busy.current) return; busy.current = true;
    try {
      if (!intent.current) { const bid = await save(); intent.current = { bid, generation: generation(), requestId: crypto.randomUUID(), scheduledAt: scheduleAt ? new Date(scheduleAt).getTime() : null }; onIntent(); }
      const value = intent.current;
      await api.post(`/broadcasts/${value.bid}/send`, { requestId: value.requestId, generation: value.generation, scheduledAt: value.scheduledAt }, { headers: await messageHeaders(workspace) });
      toast(value.scheduledAt ? `${dateTime(value.scheduledAt)} 발송 요청을 저장했어요.` : "발송 요청을 저장했어요. 현재 동의와 권한을 확인하며 차례로 진행해요.", "success");
      onDone();
    } catch (e) {
      closeConfirm();
      toast(errorMessage(e), "danger");
    } finally { busy.current = false; }
  };
  const cancel = async () => {
    await api.post(`/broadcasts/${initial!.id}/cancel`, { generation: initial?.generation ?? "" }, { headers: await messageHeaders(workspace) });
    toast("예약을 취소했어요. 임시저장 상태로 돌아갔어요.");
    onDone();
  };
  return { test, send, cancel };
}
