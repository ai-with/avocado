import { useEffect, useState } from "react";
import { Badge, LoadingState } from "../../ui";
import { api } from "../../lib/api";
import { dateTime } from "../links/common";
import { CHANNEL_LABELS, REASON_LABELS, type Channel, type SkipReason } from "../../../shared/messaging";

type Log = { id: string; source: "automation" | "broadcast"; sourceName: string; channel: Channel; status: "sent" | "skipped" | "failed" | "bounced"; reason: SkipReason | null; at: number };
const STATUS = { sent: ["보냄", "success"], skipped: ["발송 불가", "warn"], failed: ["실패", "danger"], bounced: ["반송", "danger"] } as const;

// 리드 드로어(TASK-019 LeadDrawer)의 발송 기록 섹션
export function LeadMessageLog({ leadId }: { leadId: string }) {
  const [logs, setLogs] = useState<Log[] | null>(null);
  useEffect(() => void api.get<{ logs: Log[] }>(`/messaging/leads/${leadId}/logs`).then((r) => setLogs(r.logs)), [leadId]);
  return (
    <section className="stack-tight">
      <h4>발송 기록</h4>
      {!logs && <LoadingState pattern="list" lines={2} />}
      {logs?.length === 0 && <p className="text-secondary">아직 보낸 메시지가 없어요.</p>}
      {logs?.map((l) => (
        <div key={l.id} className="text-secondary">
          {dateTime(l.at)} · {l.source === "automation" ? "자동" : "1회성"} · {l.sourceName} · {CHANNEL_LABELS[l.channel]}{" "}
          <Badge tone={STATUS[l.status][1]}>{STATUS[l.status][0]}</Badge>
          {l.reason && ` ${REASON_LABELS[l.reason] ?? l.reason}`}
        </div>
      ))}
    </section>
  );
}
