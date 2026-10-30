import { Badge, EmptyState, LoadingState, SectionCard, Table } from "../../../ui";
import { fmtDateTime } from "../../guides/types";
import { SUPPORT_LIST_LIMIT, SUPPORT_STATUS_LABEL, supportTypeLabel, type SupportRequestItem } from "../../../../shared/support";

const COLUMNS = [{ label: "보낸 시각" }, { label: "유형" }, { label: "상태" }];

// 내가 보낸 문의 최근 10개
export function SupportHistory({ requests }: { requests: SupportRequestItem[] | null }) {
  return (
    <SectionCard title="내가 보낸 문의" description={`최근 ${SUPPORT_LIST_LIMIT}개까지 보여요.`}>
      {requests === null ? (
        <LoadingState pattern="table" lines={2} label="보낸 문의를 불러오는 중" />
      ) : requests.length === 0 ? (
        <EmptyState compact title="아직 보낸 문의가 없어요" description="막히는 곳이 있으면 위 양식으로 알려 주세요." />
      ) : (
        <Table columns={COLUMNS}>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{fmtDateTime(r.createdAt)}</td>
                <td>{supportTypeLabel(r.type)}</td>
                <td className="nowrap"><Badge>{SUPPORT_STATUS_LABEL[r.status]}</Badge></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </SectionCard>
  );
}
