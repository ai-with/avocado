import { useEffect, useRef, useState } from "react";
import { Badge, Button, EmptyState, LoadingState, PageHeader, Table, useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import { allPassed, CHANNEL_LABELS, DELAY_NOTICE, KIND_LABELS } from "../../../shared/messaging";
import { checksOf, sentence, type Automation, type ListResponse } from "./automation-model";
import { AutomationEditor } from "./AutomationEditor";
import { messageHeaders, useMessageAvailability } from "./message-availability";

// /automations: 제출 후 자동 발송 (F-66)
export function AutomationsPage() {
  const toast = useToast();
  const canEdit = ["owner", "editor"].includes(useMe().me?.role ?? "");
  const availability = useMessageAvailability(), workspace = useRef(useMe().me?.workspace?.id ?? "");
  const [data, setData] = useState<ListResponse | null>(null);
  const [editing, setEditing] = useState<Automation | "new" | null>(null);
  const load = () => void api.get<ListResponse>("/automations").then(setData);
  useEffect(load, []);
  if (!data) return <LoadingState pattern="table" />;

  const toggle = async (a: Automation) => {
    try {
      await api.post(`/automations/${a.id}/toggle`, { enabled: !a.enabled, expectedGeneration: a.generation ?? "" }, { headers: await messageHeaders(workspace.current) });
      toast(a.enabled ? "규칙을 껐어요." : "규칙을 켰어요. 이제 조건이 맞으면 자동으로 보내요.", "success");
      load();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };

  if (editing) return <AutomationEditor initial={editing === "new" ? null : editing} lk={data.lookups} connected={data.alimtalkConnected} onDone={() => (setEditing(null), load())} />;

  const create = canEdit && <Button onClick={() => setEditing("new")}>규칙 만들기</Button>;
  return (
    <>
      <PageHeader title="자동 발송" description="폼을 내거나 자료를 읽은 사람에게 정해 둔 메시지를 자동으로 보내요. 상대가 먼저 행동했을 때만, 켜 둔 규칙대로 나가요." actions={create} />
      {!availability.available && <p role="status" className="msg-notice">{availability.message}</p>}
      {data.automations.length === 0 ? (
        <EmptyState title="아직 자동 발송 규칙이 없어요" description="예: 누군가 체험 신청 폼을 제출하면 즉시 확인 이메일을 보내요." action={create} />
      ) : (
        <AutomationTable data={data} canEdit={canEdit} canEnable={availability.available} onOpen={setEditing} onToggle={(a) => void toggle(a)} />
      )}
      <p className="text-caption mt-section">{DELAY_NOTICE}</p>
    </>
  );
}

type TableProps = { data: ListResponse; canEdit: boolean; canEnable: boolean; onOpen: (a: Automation) => void; onToggle: (a: Automation) => void };

function AutomationTable({ data, canEdit, canEnable, onOpen, onToggle }: TableProps) {
  return (
    <Table>
      <thead><tr><th>이름</th><th>언제</th><th>채널</th><th>성격</th><th className="num">최근 7일 발송</th><th>상태</th></tr></thead>
      <tbody>
        {data.automations.map((a) => {
          const ok = allPassed(checksOf(a, data.alimtalkConnected));
          return (
            <tr key={a.id}>
              <td><button type="button" className="link-button" onClick={() => onOpen(a)}>{a.name}</button></td>
              <td className="wrap">{sentence(a, data.lookups)}</td>
              <td>{CHANNEL_LABELS[a.channel]}</td>
              <td><Badge tone={a.kind === "ad" ? "warn" : "neutral"}>{KIND_LABELS[a.kind]}</Badge></td>
              <td className="num">{a.recentSent}건</td>
              <td>
                <div className="row">
                  <Badge tone={a.enabled ? "success" : "neutral"}>{a.enabled ? "켜짐" : "꺼짐"}</Badge>
                  {canEdit && (
                    <Button size="sm" variant="secondary" disabled={!a.enabled && (!ok || !canEnable)} title={!canEnable ? "발송 기준과 발신 설정을 준비하고 있어요" : !ok ? "발송 전 점검을 통과해야 켤 수 있어요" : undefined} onClick={() => onToggle(a)}>
                      {a.enabled ? "끄기" : "켜기"}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
