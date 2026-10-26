import { Badge, Table, type BadgeTone } from "../../../../ui";
import { fmtDate } from "../../../../features/guides/types";
import { STATUS_LABEL, type Candidate, type CandidateStatus } from "../useSampleCandidates";

const STATUS_TONE: Record<CandidateStatus, BadgeTone> = {
  reviewing: "neutral",
  proposed: "info",
  accepted: "success",
};

export function CandidateTable({ rows }: { rows: Candidate[] }) {
  return (
    <Table columns={[{ label: "이름" }, { label: "인스타 핸들" }, { label: "팔로워", num: true }, { label: "상태" }, { label: "마지막 연락일" }]}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.name}</td>
            <td className="mono nowrap">@{r.handle}</td>
            <td className="num">{r.followers.toLocaleString("ko-KR")}</td>
            <td className="nowrap"><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
            <td className="nowrap">{fmtDate(r.lastContactAt)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
