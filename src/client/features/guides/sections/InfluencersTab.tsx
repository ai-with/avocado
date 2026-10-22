import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, LoadingState, Table, useToast } from "../../../ui";
import { api, errorMessage } from "../../../lib/api";
import type { GuideInfluencerRow } from "../types";
import { InfluencerTableRow, type RowActions } from "./InfluencerTableRow";
import { AddInfluencerModal } from "./AddInfluencerModal";
import { ConsentModal } from "./ConsentModal";

function useGuideInfluencers(base: string) {
  const toast = useToast();
  const [rows, setRows] = useState<GuideInfluencerRow[] | null>(null);
  const load = useCallback(async () => setRows((await api.get<{ rows: GuideInfluencerRow[] }>(base)).rows), [base]);
  useEffect(() => void load(), [load]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast(done, "success");
      await load();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  const actions: RowActions = {
    email: (r) =>
      act(async () => {
        const res = await api.post<{ email: { delivered: boolean } }>(`${base}/${r.id}/email`);
        if (!res.email.delivered) throw new Error("이메일 발송 설정이 없어 보내지 못했습니다. 링크를 복사해 보내 주세요.");
      }, "이메일을 보냈습니다."),
    reissue: (r) => act(() => api.post(`${base}/${r.id}/reissue`), "새 링크를 만들었습니다."),
    remove: (r) => act(() => api.del(`${base}/${r.id}`), "가이드에서 뺐습니다."),
  };
  return { rows, load, actions };
}

export function InfluencersTab({ guideId, canEdit, published }: { guideId: string; canEdit: boolean; published: boolean }) {
  const base = `/guides/${guideId}/influencers`;
  const { rows, load, actions } = useGuideInfluencers(base);
  const [adding, setAdding] = useState(false);
  const [consentOf, setConsentOf] = useState<GuideInfluencerRow | null>(null);

  if (rows === null) return <LoadingState />;
  return (
    <div className="stack">
      {canEdit && <div><Button onClick={() => setAdding(true)}>인플루언서 추가</Button></div>}
      {rows.length === 0 ? (
        <EmptyState title="아직 인플루언서가 없어요" description="인플루언서를 추가하면 사람마다 가이드 링크가 만들어져서 누가 열었는지 알 수 있어요." />
      ) : (
        <Table>
          <thead>
            <tr><th>이름</th><th>인스타·스레드</th><th>이메일</th><th>언어</th><th>국가</th><th>링크</th><th>열람</th><th>단계 상태</th><th>게시물 URL</th>{canEdit && <th><span className="sr-only">관리</span></th>}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <InfluencerTableRow key={r.id} row={r} base={base} canEdit={canEdit} published={published} actions={actions} onConsent={setConsentOf} onSaved={load} />
            ))}
          </tbody>
        </Table>
      )}
      <AddInfluencerModal open={adding} onClose={() => setAdding(false)} base={base} existing={rows.map((r) => r.influencer.id)} onAdded={load} />
      <ConsentModal row={consentOf} base={base} onClose={() => setConsentOf(null)} />
    </div>
  );
}
