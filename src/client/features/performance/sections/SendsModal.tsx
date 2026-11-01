import { useEffect, useState } from "react";
import { EmptyState, Modal, Table } from "../../../ui";
import { api } from "../../../lib/api";
import { fmtDateTime } from "../../guides/types";
import { SEND_STATUS_LABELS } from "../../../../shared/performance";
import type { Rule, Send } from "../kdmTypes";

export function SendsModal({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const [sends, setSends] = useState<Send[]>([]);
  useEffect(() => {
    if (rule) void api.get<{ sends: Send[] }>(`/keyword-dm/${rule.id}/sends`).then((d) => setSends(d.sends));
  }, [rule]);
  return (
    <Modal open={rule !== null} title="발송 기록" onClose={onClose} size="lg">
      {sends.length === 0 ? (
        <EmptyState compact title="아직 발송 기록이 없어요" description="규칙을 켠 뒤 키워드 댓글이 달리면 여기에 쌓여요." />
      ) : (
        <Table>
          <thead><tr><th>댓글 시각</th><th>댓글</th><th>발송 시각</th><th>결과</th></tr></thead>
          <tbody>
            {sends.map((s) => (
              <tr key={s.id}>
                <td className="nowrap">{fmtDateTime(s.commentAt)}</td>
                <td className="wrap">{s.username ? `@${s.username} ` : ""}{s.commentText}</td>
                <td className="nowrap">{fmtDateTime(s.sentAt)}</td>
                <td>{SEND_STATUS_LABELS[s.status]}{s.reason && <div className="text-caption">{s.reason === "send_policy_unconfigured" ? "DM 발송 기준 준비 중" : s.reason}</div>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Modal>
  );
}
