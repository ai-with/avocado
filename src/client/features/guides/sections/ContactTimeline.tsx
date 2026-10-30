import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, EmptyState, LoadingState, Textarea, useToast } from "../../../ui";
import { api, errorMessage } from "../../../lib/api";
import { fmtDateTime, type ContactLog } from "../types";
import { LOG_KIND_LABEL } from "../participation";

const CHANNEL_LABEL = { dm: "DM", email: "이메일" } as const;

function useContactLogs(path: string) {
  const toast = useToast();
  const [logs, setLogs] = useState<ContactLog[] | null>(null);
  const load = useCallback(async () => {
    try {
      setLogs((await api.get<{ logs: ContactLog[] }>(`${path}/logs`)).logs);
    } catch (e) {
      toast(errorMessage(e), "danger");
      setLogs([]);
    }
  }, [path, toast]);
  useEffect(() => void load(), [load]);
  const addNote = async (body: string) => {
    try {
      await api.post(`${path}/logs`, { body });
      await load();
      return true;
    } catch (e) {
      toast(errorMessage(e), "danger");
      return false;
    }
  };
  return { logs, load, addNote };
}

function NoteForm({ onAdd }: { onAdd: (body: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    if (await onAdd(text)) setText("");
    setBusy(false);
  };
  return (
    <form className="stack-tight" noValidate onSubmit={submit}>
      <Textarea autoGrow label="메모 남기기" hint="인플루언서에게는 보이지 않아요." rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row row-end">
        <Button type="submit" size="sm" variant="secondary" disabled={!text.trim()} loading={busy}>메모 남기기</Button>
      </div>
    </form>
  );
}

// 소통 이력: 상태 변경·업로드·피드백·승인·메일·메모를 시간순으로. path = /guides/:id/influencers/:giId
export function ContactTimeline({ path, canEdit, reloadKey = 0 }: { path: string; canEdit: boolean; reloadKey?: number }) {
  const { logs, load, addNote } = useContactLogs(path);
  useEffect(() => void (reloadKey > 0 && load()), [reloadKey, load]);
  if (logs === null) return <LoadingState lines={2} label="소통 이력을 불러오는 중" />;
  return (
    <div className="stack">
      {logs.length === 0 ? (
        <EmptyState compact title="아직 소통 이력이 없어요" description="상태가 바뀌거나 영상이 올라오면 여기에 쌓여요." />
      ) : (
        <ol className="timeline stack">
          {logs.map((l) => (
            <li key={l.id} className="stack-tight">
              <div className="row row-tight row-wrap">
                <Badge tone={l.kind === "note" ? "accent" : "neutral"}>{LOG_KIND_LABEL[l.kind]}</Badge>
                {l.channel && <Badge>{CHANNEL_LABEL[l.channel]}</Badge>}
                <span className="text-caption">{fmtDateTime(l.createdAt)}</span>
              </div>
              <p className="pre-wrap">{l.body}</p>
            </li>
          ))}
        </ol>
      )}
      {canEdit && <NoteForm onAdd={addNote} />}
    </div>
  );
}
