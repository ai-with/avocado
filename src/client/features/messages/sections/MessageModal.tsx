import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, CopyButton, EmptyState, LoadingState, Modal, Select, Textarea, useToast, SelectMenu } from "../../../ui";
import { api, errorMessage } from "../../../lib/api";
import { LANG_LABEL, MESSAGE_LANGS, PURPOSE_LABEL, type MessageLang } from "../../../../shared/message-render";
import { useMessageComposer } from "../useMessageComposer";
import { MessagePreview } from "./MessagePreview";

type Props = { path: string; name: string; canEdit: boolean; onClose: () => void; onSent: () => Promise<void> };
type Channel = "dm" | "email";

const SETTINGS = "/dashboard/settings/messages";

function useSend(path: string, onSent: () => Promise<void>, onClose: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState<Channel | null>(null);
  const send = async (channel: Channel, payload: { lang: MessageLang; body: string; templateId: string | null }) => {
    setBusy(channel);
    try {
      await api.post(`${path}/messages`, { channel, ...payload });
      toast(channel === "email" ? "이메일을 보내고 소통 이력에 남겼어요." : "보냄으로 기록했어요.", "success");
      await onSent();
      onClose();
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(null);
    }
  };
  return { busy, send };
}

// 인플루언서 행·패널의 '메시지': 템플릿을 채워 복사한 뒤 보냄으로 기록, 이메일이 있으면 바로 보내기 (TASK-073)
export function MessageModal({ path, name, canEdit, onClose, onSent }: Props) {
  const c = useMessageComposer(path);
  const { busy, send } = useSend(path, onSent, onClose);
  const sendLang = c.picked?.lang ?? c.lang;
  const payload = { lang: sendLang, body: c.text, templateId: c.template?.id ?? null };
  const ready = c.text.trim().length > 0 && busy === null;
  const footer = canEdit && c.templates?.length ? (
    <>
      {c.ctx?.hasEmail && <Button variant="secondary" disabled={!ready} loading={busy === "email"} onClick={() => void send("email", payload)}>이메일로 보내기</Button>}
      <CopyButton text={c.text} size="md" doneMessage="메시지를 복사했어요. 인스타그램 DM에 붙여 넣어 보내 주세요." disabled={!c.text.trim()} />
      <Button disabled={!ready} loading={busy === "dm"} onClick={() => void send("dm", payload)}>DM 보냄으로 기록</Button>
    </>
  ) : undefined;

  return (
    <Modal open size="lg" title={`${name}님에게 메시지`} description="인스타그램은 브랜드가 먼저 DM을 보내는 공식 방법이 없어요. 복사해서 직접 보낸 뒤 보냄으로 기록해 주세요." onClose={onClose} footer={footer}>
      {c.templates === null || c.ctx === null ? (
        <LoadingState lines={4} label="템플릿을 불러오는 중" />
      ) : c.templates.length === 0 ? (
        <EmptyState compact title="아직 템플릿이 없어요" description="설정에서 템플릿을 만들면 여기서 값을 채워 보낼 수 있어요." action={<Link to={SETTINGS}>템플릿 만들러 가기</Link>} />
      ) : (
        <div className="stack">
          <div className="msg-grid">
            <SelectMenu label="템플릿" options={c.templates.map((t) => ({ value: t.id, label: t.name, description: PURPOSE_LABEL[t.purpose] }))} value={c.templateId || null} onChange={(v) => v && c.setTemplateId(v)} />
            <Select label="언어" hint={`인플루언서 언어: ${LANG_LABEL[c.ctx.lang]}`} value={c.lang} onChange={(e) => c.setLang(e.target.value as MessageLang)}>
              {MESSAGE_LANGS.map((l) => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
            </Select>
          </div>
          {c.picked?.fallback && <p className="text-caption" role="status">이 템플릿에 {LANG_LABEL[c.lang]} 본문이 없어서 {LANG_LABEL[c.picked.lang]} 본문을 썼어요.</p>}
          {c.result ? <MessagePreview result={c.result} /> : <p className="text-caption">이 템플릿에 본문이 없어요. 설정에서 본문을 넣어 주세요.</p>}
          <Textarea autoGrow label="보낼 내용" hint="직접 고칠 수 있어요. 고친 내용 그대로 복사·기록돼요." rows={8} value={c.text} onChange={(e) => c.setText(e.target.value)} disabled={!canEdit} />
        </div>
      )}
    </Modal>
  );
}
