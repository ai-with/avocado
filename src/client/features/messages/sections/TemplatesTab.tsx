import { useState } from "react";
import { Badge, Button, EmptyState, LoadingState, Table, useToast } from "../../../ui";
import { api, errorMessage } from "../../../lib/api";
import { LANG_LABEL, MESSAGE_LANGS, PURPOSE_LABEL, unknownKeys } from "../../../../shared/message-render";
import { knownKeys, type MessageTemplate, type MessageVariable } from "../api";
import { TemplateEditModal } from "./TemplateEditModal";

type Props = { templates: MessageTemplate[] | null; variables: MessageVariable[]; canEdit: boolean; reload: () => Promise<void> };
type Editing = { template: MessageTemplate | null } | null;

function TemplateRow({ t, known, canEdit, onEdit, onRemove }: { t: MessageTemplate; known: ReadonlySet<string>; canEdit: boolean; onEdit: () => void; onRemove: () => void }) {
  const missing = unknownKeys(Object.values(t.bodies).join("\n"), known);
  return (
    <tr>
      <td>
        <div className="stack-tight">
          <span>{t.name}</span>
          {missing.length > 0 && <span className="text-caption text-danger">없는 변수: {missing.join(", ")}</span>}
        </div>
      </td>
      <td className="nowrap"><Badge>{PURPOSE_LABEL[t.purpose]}</Badge></td>
      <td className="nowrap">
        <div className="row row-tight">
          {MESSAGE_LANGS.map((l) => <Badge key={l} tone={t.bodies[l] ? "success" : "neutral"}>{LANG_LABEL[l]} {t.bodies[l] ? "있음" : "없음"}</Badge>)}
        </div>
      </td>
      {canEdit && (
        <td className="text-right">
          <div className="row row-end">
            <Button size="sm" variant="ghost" onClick={onEdit}>수정</Button>
            <Button size="sm" variant="ghost" onClick={onRemove}>삭제</Button>
          </div>
        </td>
      )}
    </tr>
  );
}

// 템플릿 탭: 목록(이름, 용도, 언어 채움 여부)과 추가·수정·삭제 (TASK-073)
export function TemplatesTab({ templates, variables, canEdit, reload }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState<Editing>(null);
  const known = knownKeys(variables);
  const remove = async (t: MessageTemplate) => {
    if (!confirm(`${t.name} 템플릿을 지울까요?`)) return;
    try {
      await api.del(`/message-templates/${t.id}`);
      toast("템플릿을 지웠어요.", "success");
      await reload();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  const add = canEdit && <Button onClick={() => setEditing({ template: null })}>템플릿 추가</Button>;
  if (templates === null) return <LoadingState label="템플릿을 불러오는 중" />;
  return (
    <div className="stack">
      {templates.length === 0 ? (
        <EmptyState title="아직 템플릿이 없어요" description="자주 보내는 DM을 템플릿으로 만들면 인플루언서마다 값을 채워 바로 복사할 수 있어요." action={add} />
      ) : (
        <>
          {add && <div>{add}</div>}
          <Table>
            <thead>
              <tr><th>이름</th><th>용도</th><th>언어</th>{canEdit && <th><span className="sr-only">관리</span></th>}</tr>
            </thead>
            <tbody>
              {templates.map((t) => <TemplateRow key={t.id} t={t} known={known} canEdit={canEdit} onEdit={() => setEditing({ template: t })} onRemove={() => void remove(t)} />)}
            </tbody>
          </Table>
        </>
      )}
      {editing && <TemplateEditModal template={editing.template} variables={variables} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
