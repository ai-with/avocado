import { useState, type FormEvent } from "react";
import { Badge, Button, Input, Modal, Table, useToast } from "../../../ui";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { SYSTEM_VARIABLES, VAR_KEY_MAX, varKeyProblem, varToken } from "../../../../shared/message-render";
import type { MessageVariable } from "../api";

type Props = { variables: MessageVariable[]; canEdit: boolean; reload: () => Promise<void> };
type Editing = { id: string | null; key: string; label: string; defaultValue: string };
const FORM_ID = "message-variable-form";

function useVariableEditor(variables: MessageVariable[], reload: () => Promise<void>) {
  const toast = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const open = (v: Editing | null) => {
    setFields({});
    setEditing(v);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const keyProblem = editing.id ? null : varKeyProblem(editing.key.trim(), variables.map((v) => v.key));
    if (keyProblem || !editing.label.trim()) return setFields({ ...(keyProblem && { key: keyProblem }), ...(!editing.label.trim() && { label: "이름표를 입력해 주세요." }) });
    try {
      const body = { label: editing.label, defaultValue: editing.defaultValue };
      if (editing.id) await api.patch(`/message-variables/${editing.id}`, body);
      else await api.post("/message-variables", { ...body, key: editing.key.trim() });
      toast("변수를 저장했어요.", "success");
      open(null);
      await reload();
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      toast(errorMessage(err), "danger");
    }
  };
  // 쓰는 템플릿이 있으면 이름을 보여 주고 한 번 더 묻는다
  const remove = async (v: MessageVariable) => {
    try {
      const { templates } = await api.get<{ templates: string[] }>(`/message-variables/${v.id}/usage`);
      const usedBy = templates.length ? `\n이 변수를 쓰는 템플릿: ${templates.join(", ")}\n지우면 그 템플릿에서 없는 변수로 표시돼요.` : "";
      if (!confirm(`${v.label}(${v.key}) 변수를 지울까요?${usedBy}`)) return;
      await api.del(`/message-variables/${v.id}`);
      toast("변수를 지웠어요.", "success");
      await reload();
    } catch (err) {
      toast(errorMessage(err), "danger");
    }
  };
  return { editing, setEditing, open, fields, save, remove };
}

type ModalProps = { editing: Editing; fields: Record<string, string>; onChange: (v: Editing) => void; onSubmit: (e: FormEvent) => void; onClose: () => void };

function VariableModal({ editing, fields, onChange, onSubmit, onClose }: ModalProps) {
  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>취소</Button>
      <Button type="submit" form={FORM_ID}>저장</Button>
    </>
  );
  return (
    <Modal open title={editing.id ? "변수 수정" : "변수 추가"} onClose={onClose} footer={footer}>
      <form id={FORM_ID} className="stack" noValidate onSubmit={onSubmit}>
        <Input label="이름(key)" required hint={editing.id ? "템플릿이 이 이름으로 가리켜서 바꿀 수 없어요." : "영문 소문자·숫자·밑줄. 본문에는 {{이름}}으로 넣어요."} maxLength={VAR_KEY_MAX} value={editing.key} disabled={editing.id !== null} onChange={(e) => onChange({ ...editing, key: e.target.value })} error={fields.key} data-autofocus />
        <Input label="이름표" required maxLength={40} value={editing.label} onChange={(e) => onChange({ ...editing, label: e.target.value })} error={fields.label} />
        <Input label="기본값" hint="인플루언서별 값이 없을 때 써요. 인플루언서별 값은 캠페인 인플루언서 패널에서 넣어요." maxLength={500} value={editing.defaultValue} onChange={(e) => onChange({ ...editing, defaultValue: e.target.value })} error={fields.defaultValue} />
      </form>
    </Modal>
  );
}

// 변수 탭: 기본 변수(잠김)와 사용자 변수 추가·수정·삭제 (TASK-073)
export function VariablesTab({ variables, canEdit, reload }: Props) {
  const { editing, setEditing, open, fields, save, remove } = useVariableEditor(variables, reload);
  return (
    <div className="stack">
      {canEdit && <div><Button onClick={() => open({ id: null, key: "", label: "", defaultValue: "" })}>변수 추가</Button></div>}
      <Table>
        <thead>
          <tr><th>이름표</th><th>본문 표기</th><th>기본값</th>{canEdit && <th><span className="sr-only">관리</span></th>}</tr>
        </thead>
        <tbody>
          {variables.map((v) => (
            <tr key={v.id}>
              <td>{v.label}</td>
              <td className="mono nowrap">{varToken(v.key)}</td>
              <td>{v.defaultValue || <span className="text-caption">없음</span>}</td>
              {canEdit && (
                <td className="text-right">
                  <div className="row row-end">
                    <Button size="sm" variant="ghost" onClick={() => open({ ...v })}>수정</Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(v)}>삭제</Button>
                  </div>
                </td>
              )}
            </tr>
          ))}
          {SYSTEM_VARIABLES.map((v) => (
            <tr key={v.key}>
              <td>{v.label}</td>
              <td className="mono nowrap">{varToken(v.key)}</td>
              <td><span className="text-caption">인플루언서마다 자동</span></td>
              {canEdit && <td className="text-right"><Badge>기본 변수 · 잠김</Badge></td>}
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && <VariableModal editing={editing} fields={fields} onChange={setEditing} onSubmit={save} onClose={() => open(null)} />}
    </div>
  );
}
