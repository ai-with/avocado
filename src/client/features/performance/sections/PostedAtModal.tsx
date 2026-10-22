import { useEffect, useState } from "react";
import { Button, Input, Modal } from "../../../ui";
import { api } from "../../../lib/api";
import type { PerfRow } from "../perfTypes";

const MS_PER_MINUTE = 60_000;
const toLocalInput = (ms: number) => new Date(ms - new Date().getTimezoneOffset() * MS_PER_MINUTE).toISOString().slice(0, 16);

type Props = { row: PerfRow | null; onClose: () => void; onSaved: () => Promise<void>; onError: (e: unknown) => void };

export function PostedAtModal({ row, onClose, onSaved, onError }: Props) {
  const [v, setV] = useState("");
  useEffect(() => setV(row ? toLocalInput(row.postedAt ?? row.registeredAt) : ""), [row]);
  const save = async () => {
    try {
      await api.patch(`/performance/contents/${row!.contentId}/posted-at`, { postedAt: new Date(v).getTime() });
      await onSaved();
    } catch (e) {
      onError(e);
    }
  };
  return (
    <Modal open={row !== null} title="게시 시각 입력" onClose={onClose}>
      <div className="stack">
        <p className="text-secondary">플랫폼에서 게시 시각을 읽지 못했을 때 직접 넣어요. 표에 '수동'으로 표시돼요.</p>
        <Input type="datetime-local" label="게시 시각" value={v} onChange={(e) => setV(e.target.value)} />
        <div className="row row-end">
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button onClick={() => void save()} disabled={!v}>게시 시각 저장</Button>
        </div>
      </div>
    </Modal>
  );
}
