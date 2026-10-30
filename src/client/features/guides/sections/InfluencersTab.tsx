import { useCallback, useEffect, useState } from "react";
import { Button, ChoiceChips, EmptyState, LoadingState, Table, useToast } from "../../../ui";
import { api, errorMessage } from "../../../lib/api";
import { PARTICIPATION_STATUSES, STATUS_LABEL, type ParticipationStatus } from "../../../../shared/participation";
import { withJosa } from "../../../../shared/josa";
import type { GuideInfluencerRow } from "../types";
import { InfluencerTableRow, type RowActions } from "./InfluencerTableRow";
import { AddInfluencerModal } from "./AddInfluencerModal";
import { ConsentModal } from "./ConsentModal";
import { ParticipationDrawer } from "./ParticipationDrawer";
import { MessageModal } from "../../messages/sections/MessageModal";

type Filter = "all" | ParticipationStatus;

function useGuideInfluencers(base: string) {
  const toast = useToast();
  const [rows, setRows] = useState<GuideInfluencerRow[] | null>(null);
  // 상태를 바꾸면 열린 패널의 소통 이력도 다시 읽는다
  const [logVersion, setLogVersion] = useState(0);
  const load = useCallback(async () => setRows((await api.get<{ rows: GuideInfluencerRow[] }>(base)).rows), [base]);
  useEffect(() => void load(), [load]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast(done, "success");
      await load();
      setLogVersion((n) => n + 1);
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  const actions: RowActions = {
    email: (r) =>
      act(async () => {
        const res = await api.post<{ email: { delivered: boolean } }>(`${base}/${r.id}/email`);
        if (!res.email.delivered) throw new Error("이메일 발송 설정이 없어 보내지 못했어요. 링크를 복사해 보내 주세요.");
      }, "이메일을 보냈어요."),
    reissue: (r) => act(() => api.post(`${base}/${r.id}/reissue`), "새 링크를 만들었어요."),
    remove: (r) => act(() => api.del(`${base}/${r.id}`), "캠페인에서 뺐어요."),
    setStatus: (r, status) => act(() => api.patch(`${base}/${r.id}/status`, { status }), `상태를 ${withJosa(STATUS_LABEL[status], "으로/로")} 바꿨어요.`),
  };
  const bumpLogs = async () => setLogVersion((n) => n + 1);
  return { rows, load, actions, logVersion, bumpLogs };
}

// 상태별 개수 칩. 누르면 그 상태만 보인다
function StatusFilter({ rows, value, onChange }: { rows: GuideInfluencerRow[]; value: Filter; onChange: (f: Filter) => void }) {
  const count = (s: ParticipationStatus) => rows.filter((r) => r.participationStatus === s).length;
  const options = [{ value: "all" as Filter, label: `전체 ${rows.length}` }, ...PARTICIPATION_STATUSES.map((s) => ({ value: s as Filter, label: `${STATUS_LABEL[s]} ${count(s)}` }))];
  return <ChoiceChips<Filter> label="진행 상태" options={options} value={value} onChange={onChange} />;
}

const TableHead = ({ canEdit }: { canEdit: boolean }) => (
  <thead>
    <tr><th>이름</th><th>진행 상태</th><th>조건</th><th>인스타·스레드</th><th>이메일</th><th>언어</th><th>국가</th><th>링크</th><th>열람</th><th>단계 상태</th><th>게시물 URL</th>{canEdit && <th><span className="sr-only">관리</span></th>}</tr>
  </thead>
);

export function InfluencersTab({ guideId, canEdit, published, openAdd = false }: { guideId: string; canEdit: boolean; published: boolean; openAdd?: boolean }) {
  const base = `/guides/${guideId}/influencers`;
  const { rows, load, actions, logVersion, bumpLogs } = useGuideInfluencers(base);
  const [messageTo, setMessageTo] = useState<GuideInfluencerRow | null>(null);
  const [adding, setAdding] = useState(openAdd && canEdit);
  const [consentOf, setConsentOf] = useState<GuideInfluencerRow | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  if (rows === null) return <LoadingState pattern="table" />;
  const shown = filter === "all" ? rows : rows.filter((r) => r.participationStatus === filter);
  const open = rows.find((r) => r.id === openId) ?? null;
  return (
    <div className="stack">
      {canEdit && <div><Button onClick={() => setAdding(true)}>인플루언서 추가</Button></div>}
      {rows.length === 0 ? (
        <EmptyState title="아직 인플루언서가 없어요" description="인플루언서를 추가하면 사람마다 브랜드 가이드 링크가 만들어져서 누가 열었는지 알 수 있어요." />
      ) : (
        <>
          <StatusFilter rows={rows} value={filter} onChange={setFilter} />
          {shown.length === 0 ? (
            <EmptyState compact title="조건에 맞는 인플루언서가 없어요" action={<Button variant="secondary" onClick={() => setFilter("all")}>필터 지우기</Button>} />
          ) : (
            <Table>
              <TableHead canEdit={canEdit} />
              <tbody>
                {shown.map((r) => (
                  <InfluencerTableRow key={r.id} row={r} base={base} canEdit={canEdit} published={published} actions={actions} onConsent={setConsentOf} onOpen={(row) => setOpenId(row.id)} onMessage={setMessageTo} onSaved={load} />
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
      <AddInfluencerModal open={adding} onClose={() => setAdding(false)} base={base} existing={rows.map((r) => r.influencer.id)} onAdded={load} />
      <ConsentModal row={consentOf} base={base} onClose={() => setConsentOf(null)} />
      {open && <ParticipationDrawer row={open} base={base} canEdit={canEdit} reloadKey={logVersion} onSaved={load} onMessage={setMessageTo} onClose={() => setOpenId(null)} />}
      {messageTo && <MessageModal path={`${base}/${messageTo.id}`} name={messageTo.influencer.displayName} canEdit={canEdit} onSent={bumpLogs} onClose={() => setMessageTo(null)} />}
    </div>
  );
}
