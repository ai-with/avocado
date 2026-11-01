import { useId, useMemo, useState, type FormEvent } from "react";
import { Button, Input, Modal, Select, Tabs, Textarea, useToast } from "../../../ui";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { LANG_LABEL, MESSAGE_LANGS, PURPOSE_LABEL, SYSTEM_VARIABLES, TEMPLATE_PURPOSES, exampleValues, renderMessage, varToken, type MessageLang } from "../../../../shared/message-render";
import type { MessageTemplate, MessageVariable, TemplateDraft } from "../api";
import { MessagePreview } from "./MessagePreview";

type Props = { template: MessageTemplate | null; variables: MessageVariable[]; onClose: () => void; onSaved: () => Promise<void> };

const LANG_TABS = MESSAGE_LANGS.map((value) => ({ value, label: LANG_LABEL[value] }));
const FORM_ID = "message-template-form";

const draftOf = (t: MessageTemplate | null): TemplateDraft => ({ name: t?.name ?? "", purpose: t?.purpose ?? "contact", bodies: { ko: t?.bodies.ko ?? "", en: t?.bodies.en ?? "" } });

// 커서 위치에 {{key}} 를 넣고 커서를 그 뒤로 옮긴다
function insertAt(textareaId: string, text: string, token: string): string {
  const el = document.getElementById(textareaId) as HTMLTextAreaElement | null;
  const start = el?.selectionStart ?? text.length;
  const end = el?.selectionEnd ?? text.length;
  const next = text.slice(0, start) + token + text.slice(end);
  requestAnimationFrame(() => {
    el?.focus();
    el?.setSelectionRange(start + token.length, start + token.length);
  });
  return next;
}

function VariableButtons({ variables, onInsert }: { variables: MessageVariable[]; onInsert: (key: string) => void }) {
  const all = [...SYSTEM_VARIABLES.map((v) => ({ key: v.key, label: v.label })), ...variables.map((v) => ({ key: v.key, label: v.label }))];
  return (
    <div className="stack-tight">
      <span className="text-caption">변수 넣기 (커서 자리에 들어가요)</span>
      <div className="msg-insert">
        {all.map((v) => <Button key={v.key} size="sm" variant="secondary" onClick={() => onInsert(v.key)} title={varToken(v.key)}>{v.label}</Button>)}
      </div>
    </div>
  );
}

function useTemplateSave(template: MessageTemplate | null, onSaved: () => Promise<void>, onClose: () => void) {
  const toast = useToast();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async (draft: TemplateDraft) => {
    if (!draft.name.trim()) return setFields({ name: "템플릿 이름을 입력해 주세요." });
    setBusy(true);
    try {
      if (template) await api.patch(`/message-templates/${template.id}`, draft);
      else await api.post("/message-templates", draft);
      toast("템플릿을 저장했어요.", "success");
      await onSaved();
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setFields(e.fields);
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };
  return { fields, busy, save };
}

// 템플릿 추가·수정: 이름, 용도, 언어별 본문, 변수 넣기, 예시 값 미리보기 (TASK-073)
export function TemplateEditModal({ template, variables, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState(() => draftOf(template));
  const [lang, setLang] = useState<MessageLang>("ko");
  const bodyId = useId();
  const { fields, busy, save } = useTemplateSave(template, onSaved, onClose);
  const examples = useMemo(() => ({ ...Object.fromEntries(variables.map((v) => [v.key, v.defaultValue])), ...exampleValues(location.origin) }), [variables]);
  const setBody = (text: string) => setDraft((d) => ({ ...d, bodies: { ...d.bodies, [lang]: text } }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(draft);
  };
  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>취소</Button>
      <Button type="submit" form={FORM_ID} loading={busy}>저장</Button>
    </>
  );
  return (
    <Modal open size="lg" title={template ? "템플릿 수정" : "템플릿 추가"} onClose={onClose} footer={footer}>
      <form id={FORM_ID} className="stack" noValidate onSubmit={submit}>
        <div className="msg-grid">
          <Input label="이름" required maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} error={fields.name} data-autofocus />
          <Select label="용도" value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value as TemplateDraft["purpose"] })}>
            {TEMPLATE_PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>)}
          </Select>
        </div>
        <Tabs<MessageLang> label="본문 언어" tabs={LANG_TABS} value={lang} onChange={setLang} />
        <Textarea autoGrow id={bodyId} label={`${LANG_LABEL[lang]} 본문`} hint={lang === "ko" ? "비워 두면 이 언어로는 보내지 않고 다른 언어 본문을 써요. 변수 뒤 조사는 값에 맞게 자동으로 바뀌어요." : "비워 두면 이 언어로는 보내지 않고 다른 언어 본문을 써요."} rows={8} value={draft.bodies[lang]} onChange={(e) => setBody(e.target.value)} error={fields[`bodies.${lang}`]} />
        <VariableButtons variables={variables} onInsert={(key) => setBody(insertAt(bodyId, draft.bodies[lang], varToken(key)))} />
        {draft.bodies[lang].trim() && <MessagePreview label="예시 값으로 본 미리보기" result={renderMessage(draft.bodies[lang], examples)} />}
      </form>
    </Modal>
  );
}
