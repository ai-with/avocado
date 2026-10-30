import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, LoadingState, PageHeader } from "../../ui";
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
      <PageHeader title={TITLE} description={DESCRIPTION} actions={canEdit && data.configured && <Button onClick={() => setEditing("new")}>규칙 만들기</Button>} />
      <div className="stack">
        <KdmConnectionNotice data={data} />
        {data.rules.length === 0 ? (
          <EmptyState title="아직 규칙이 없어요" description="게시물에 '댓글에 키워드를 남기면 DM으로 자료를 보내 드려요'라고 쓰고 규칙을 만들어 보세요." />
        ) : (
          <RuleTable rules={data.rules} canEdit={canEdit} act={act} onEdit={setEditing} onLog={setLogOf} />
        )}
      </div>
      {editing && <RuleEditor rule={editing === "new" ? null : editing} defaults={data.defaultPublicReplies} brand={me?.workspace?.name ?? ""} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
      <SendsModal rule={logOf} onClose={() => setLogOf(null)} />
    </>
  );
}
