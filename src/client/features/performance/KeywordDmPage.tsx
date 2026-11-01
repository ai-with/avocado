import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, LoadingState, PageHeader } from "../../ui";
import { api } from "../../lib/api";
import { useMe } from "../../lib/me";
import type { KdmData, Rule } from "./kdmTypes";
import { useAction } from "./useAction";
import { KdmConnectionNotice } from "./sections/KdmConnectionNotice";
import { RuleTable } from "./sections/RuleTable";
import { RuleEditor } from "./sections/RuleEditor";
import { SendsModal } from "./sections/SendsModal";
import "./performance.css";

const TITLE = "자동 DM";
const DESCRIPTION = "브랜드 게시물에 키워드 댓글을 단 사람에게 리드 링크를 DM으로 한 번 보내요.";

// /keyword-dm 댓글 키워드 자동 DM (F-64, W18)
export function KeywordDmPage() {
  const { me } = useMe();
  const canEdit = me?.role === "owner" || me?.role === "editor";
  const [data, setData] = useState<KdmData | null>(null);
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [logOf, setLogOf] = useState<Rule | null>(null);
  const load = useCallback(async () => setData(await api.get<KdmData>("/keyword-dm")), []);
  useEffect(() => void load(), [load]);
  const act = useAction(load);
  if (!data) return <><PageHeader title={TITLE} description={DESCRIPTION} /><LoadingState pattern="table" /></>;

  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} actions={canEdit && <Button onClick={() => setEditing("new")}>규칙 만들기</Button>} />
      <div className="stack">
        {data.sendPolicy?.configured !== true && <Card><p role="status">{data.sendPolicy?.message ?? "DM 발송 기준을 준비하고 있어요. 실제 DM과 후속 공개 답글은 아직 사용할 수 없어요."}</p></Card>}
        <KdmConnectionNotice data={data} />
        {data.rules.length === 0 ? (
          <EmptyState title="아직 규칙이 없어요" description={data.sendPolicy?.configured === true
            ? "게시물에 '댓글에 키워드를 남기면 DM으로 자료를 보내 드려요'라고 쓰고 규칙을 만들어 보세요."
            : "DM 발송 기준을 준비하고 있어요. 규칙 초안을 미리 작성할 수 있어요."} />
        ) : (
          <RuleTable rules={data.rules} canEdit={canEdit} canSend={data.sendPolicy?.configured === true} act={act} onEdit={setEditing} onLog={setLogOf} />
        )}
      </div>
      {editing && <RuleEditor rule={editing === "new" ? null : editing} defaults={data.defaultPublicReplies} canSend={data.sendPolicy?.configured === true} brand={me?.workspace?.name ?? ""} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
      <SendsModal rule={logOf} onClose={() => setLogOf(null)} />
    </>
  );
}
