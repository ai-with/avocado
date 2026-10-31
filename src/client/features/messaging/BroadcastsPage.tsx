import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, LoadingState, PageHeader, Table } from "../../ui";
import { api } from "../../lib/api";
import { useMe } from "../../lib/me";
import { dateTime } from "../links/common";
import { CHANNEL_LABELS, KIND_LABELS } from "../../../shared/messaging";
import { resultText, deliveryLabel, type Broadcast } from "./broadcast-model";
import { useMessageAvailability } from "./message-availability";
import { BroadcastEditor } from "./BroadcastEditor";

type ListResponse = { broadcasts: Broadcast[]; alimtalkConnected: boolean };

// /broadcasts: 1회성 발송 (F-67)
export function BroadcastsPage() {
  const canEdit = ["owner", "editor"].includes(useMe().me?.role ?? "");
  const availability = useMessageAvailability();
  const [list, setList] = useState<ListResponse | null>(null);
  const [editing, setEditing] = useState<Broadcast | "new" | null>(null);
  const load = () => void api.get<ListResponse>("/broadcasts").then(setList);
  useEffect(load, []);
  if (!list) return <LoadingState pattern="table" />;
  if (editing) return <BroadcastEditor initial={editing === "new" ? null : editing} connected={list.alimtalkConnected} onDone={() => (setEditing(null), load())} />;

  const create = canEdit && <Button onClick={() => setEditing("new")}>새 발송 만들기</Button>;
  return (
    <>
      <PageHeader title="1회성 발송" description="모인 리드 그룹에 출시 소식, 마감 안내를 한 번 보내요. 보낼 때마다 직접 '보내기'를 눌러야 나가요." actions={create} />
      {!availability.available && <p role="status" className="msg-notice">{availability.message}</p>}
      {list.broadcasts.length === 0 ? (
        <EmptyState title="아직 보낸 메시지가 없어요" description="리드 화면에서 그룹이나 태그를 만들면 여기서 받는 사람으로 고를 수 있어요." action={create} />
      ) : (
        <BroadcastTable broadcasts={list.broadcasts} onOpen={setEditing} />
      )}
    </>
  );
}

function BroadcastTable({ broadcasts, onOpen }: { broadcasts: Broadcast[]; onOpen: (b: Broadcast) => void }) {
  return (
    <Table>
      <thead><tr><th>이름</th><th>채널</th><th>성격</th><th>상태</th><th>결과</th><th>시각</th></tr></thead>
      <tbody>
        {broadcasts.map((b) => (
          <tr key={b.id}>
            <td><button type="button" className="link-button" onClick={() => onOpen(b)}>{b.name || "이름 없음"}</button></td>
            <td>{CHANNEL_LABELS[b.channel]}</td>
            <td><Badge tone={b.kind === "ad" ? "warn" : "neutral"}>{KIND_LABELS[b.kind]}</Badge></td>
            <td><Badge tone={b.stats?.unknown ? "warn" : b.status === "sent" ? "success" : b.status === "draft" ? "neutral" : "info"}>{deliveryLabel(b)}</Badge></td>
            <td className="wrap">{b.stats ? resultText(b.stats) : ""}</td>
            <td className="nowrap">{dateTime(b.sentAt ?? b.scheduledAt ?? b.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
