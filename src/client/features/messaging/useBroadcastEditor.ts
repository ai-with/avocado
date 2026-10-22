import { useEffect, useRef, useState } from "react";
import { useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { dateTime } from "../links/common";
import { allPassed, validateTemplate, type Audience } from "../../../shared/messaging";
import { NEW, type Broadcast, type Count, type Draft, type Group, type Named } from "./broadcast-model";

const COUNT_DEBOUNCE_MS = 300;
const AUTOSAVE_DEBOUNCE_MS = 5000;

function useAudienceOptions() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [tags, setTags] = useState<Named[]>([]);
  useEffect(() => {
    void api.get<{ groups: Group[] }>("/leads/groups").then((r) => setGroups(r.groups));
    void api.get<{ tags: Named[] }>("/leads/tags").then((r) => setTags(r.tags));
  }, []);
  return { groups, tags };
}

// 받는 사람 실시간 집계
function useAudienceCount(d: Draft) {
  const [count, setCount] = useState<Count | null>(null);
  useEffect(() => {
    const t = setTimeout(() => void api.post<Count>("/broadcasts/audience", { audience: d.audience, channel: d.channel, kind: d.kind }).then(setCount), COUNT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [d.audience, d.channel, d.kind]);
  return count;
}

// 자동 임시저장 (5초 디바운스). 첫 저장에서 초안을 만든다
function useDraft(initial: Broadcast | null, locked: boolean) {
  const toast = useToast();
  const [id, setId] = useState(initial?.id ?? null);
  const [d, setD] = useState<Draft>(initial ?? NEW);
  const [savedAt, setSavedAt] = useState<number | null>(initial?.updatedAt ?? null);
  const dirty = useRef(false);
  const set = (patch: Partial<Draft>) => ((dirty.current = true), setD((p) => ({ ...p, ...patch })));
  const save = async (): Promise<string> => {
    dirty.current = false;
    if (id) {
      const r = await api.patch<{ updatedAt: number }>(`/broadcasts/${id}`, d);
      setSavedAt(r.updatedAt);
      return id;
    }
    const r = await api.post<{ broadcast: Broadcast }>("/broadcasts", d);
    setId(r.broadcast.id);
    setSavedAt(r.broadcast.updatedAt);
    return r.broadcast.id;
  };
  useEffect(() => {
    if (locked || !dirty.current) return;
    const t = setTimeout(() => void save().catch((e: unknown) => toast(errorMessage(e), "danger")), AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [d]);
  return { d, set, savedAt, save, isDirty: () => dirty.current };
}

export function useBroadcastEditor(initial: Broadcast | null, connected: boolean, onDone: () => void) {
  const locked = !!initial && initial.status !== "draft";
  const draft = useDraft(initial, locked);
  const { d, set } = draft;
  const count = useAudienceCount(d);
  const options = useAudienceOptions();
  const [scheduleAt, setScheduleAt] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const hasAudience = d.audience.groupIds.length + d.audience.tagIds.length > 0;
  const checks = validateTemplate({ channel: d.channel, kind: d.kind, template: d.template, hasTarget: hasAudience, alimtalkConnected: connected, senderReady: true });
  const toggleAudience = (key: keyof Audience, value: string) => {
    const cur = d.audience[key];
    set({ audience: { ...d.audience, [key]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] } });
  };
  const actions = useBroadcastActions(draft.save, initial, scheduleAt, onDone, () => setConfirmOpen(false));
  const leave = () => (draft.isDirty() && !locked ? void draft.save().then(onDone) : onDone());
  return {
    ...draft, ...actions, ...options, count, locked, hasAudience, checks, toggleAudience, leave,
    scheduleAt, setScheduleAt, confirmOpen, setConfirmOpen,
    blockedAlimtalk: d.channel === "alimtalk" && !connected,
    canSend: !locked && allPassed(checks) && (count?.eligible ?? 0) > 0,
  };
}

function useBroadcastActions(save: () => Promise<string>, initial: Broadcast | null, scheduleAt: string, onDone: () => void, closeConfirm: () => void) {
  const toast = useToast();
  const test = async () => {
    try {
      const bid = await save();
      const r = await api.post<{ to: string; delivered: boolean }>(`/broadcasts/${bid}/test`);
      toast(r.delivered ? `${r.to} 주소로만 보냈어요. 리드 발송 기록에는 남지 않아요.` : "이메일 발송 설정이 없어 실제로 보내지는 않았어요. 리드 기록에는 남지 않아요.", r.delivered ? "success" : "neutral");
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  const send = async () => {
    try {
      const bid = await save();
      const at = scheduleAt ? new Date(scheduleAt).getTime() : null;
      const r = await api.post<{ recipients: number }>(`/broadcasts/${bid}/send`, { scheduledAt: at });
      toast(at ? `${dateTime(at)}에 ${r.recipients}명에게 보내도록 예약했어요.` : `${r.recipients}명에게 보내기 시작했어요.`, "success");
      onDone();
    } catch (e) {
      closeConfirm();
      toast(errorMessage(e), "danger");
    }
  };
  const cancel = async () => {
    await api.post(`/broadcasts/${initial!.id}/cancel`);
    toast("예약을 취소했어요. 임시저장 상태로 돌아갔어요.");
    onDone();
  };
  return { test, send, cancel };
}
