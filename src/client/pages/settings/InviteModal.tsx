import { useRef, useState, type FormEvent } from "react";
import { Button, CopyButton, Input, Modal, SelectMenu } from "../../ui";
import { useMe } from "../../lib/me";
import { api, ApiError } from "../../lib/api";
import type { Role } from "../../../shared/roles";
import { FormError } from "../AuthCard";
import { useSubmit } from "../useSubmit";
import { INVITE_COPIED, ROLE_OPTIONS, type InviteResult } from "./workspaceTypes";

function InviteCreated({ result, onClose }: { result: InviteResult; onClose: () => void }) {
  return (
    <div className="stack">
      <p>
        {result.email.delivered
          ? `${result.invite.email} 주소로 초대 메일을 보냈어요.`
          : result.email.reason === "provider_error" ? "메일을 보내지 못했어요. 아래 링크를 직접 전달해 주세요." : "이메일 발송 설정이 없어 메일은 보내지 않았어요. 아래 링크를 직접 전달해 주세요."}
      </p>
      <Input label="초대 링크" value={result.invite.url} readOnly onFocus={(e) => e.target.select()} />
      <div className="row row-end">
        <CopyButton text={result.invite.url} label="링크 복사" doneMessage={INVITE_COPIED} size="md" />
        <Button onClick={onClose}>완료</Button>
      </div>
    </div>
  );
}

export function InviteModal({ open, onClose, onCreated, expectedWorkspaceId }: { open: boolean; onClose: () => void; onCreated: () => Promise<void>; expectedWorkspaceId: string }) {
  const { me, refresh } = useMe();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const pending = useRef(false);
  const { error, fields, busy, run, reset } = useSubmit();
  const [result, setResult] = useState<InviteResult | null>(null);

  const close = () => {
    if (pending.current) return;
    setEmail("");
    setResult(null);
    reset();
    onClose();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    void run(async () => {
      try { setResult(await api.post<InviteResult>("/workspace/invites", { email, role, expectedWorkspaceId, expectedUserId: me?.user.id })); }
      catch (error) { if (error instanceof ApiError && ["workspace_changed", "session_changed", "forbidden"].includes(error.code)) await refresh(); throw error; }
      await onCreated();
    }).finally(() => { pending.current = false; });
  };

  return (
    <Modal open={open} title="팀원 초대" onClose={close}>
      {result ? (
        <InviteCreated result={result} onClose={close} />
      ) : (
        <form className="stack" noValidate onSubmit={submit}>
          <Input label="이메일" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} required />
          <SelectMenu label="역할" options={ROLE_OPTIONS} value={role} onChange={(v) => v && setRole(v as Role)} />
          <FormError message={error} />
          <div className="row row-end">
            <Button variant="ghost" onClick={close} disabled={busy}>취소</Button>
            <Button type="submit" loading={busy}>초대 링크 만들기</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
