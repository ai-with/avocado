import { useState, type FormEvent } from "react";
import { Button, CopyButton, Input, Modal, Select } from "../../ui";
import { api } from "../../lib/api";
import { ROLE_LABELS, type Role } from "../../../shared/roles";
import { FormError } from "../AuthCard";
import { useSubmit } from "../useSubmit";
import { ASSIGNABLE, INVITE_COPIED, type InviteResult } from "./workspaceTypes";

function InviteCreated({ result, onClose }: { result: InviteResult; onClose: () => void }) {
  return (
    <div className="stack">
      <p>
        {result.email.delivered
          ? `${result.invite.email} 주소로 초대 메일을 보냈어요.`
          : "이메일 발송 설정이 없어 메일은 보내지 않았어요. 아래 링크를 직접 전달해 주세요."}
      </p>
      <Input label="초대 링크" value={result.invite.url} readOnly onFocus={(e) => e.target.select()} />
      <div className="row row-end">
        <CopyButton text={result.invite.url} label="링크 복사" doneMessage={INVITE_COPIED} size="md" />
        <Button onClick={onClose}>완료</Button>
      </div>
    </div>
  );
}

export function InviteModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const { error, fields, run, reset } = useSubmit();
  const [result, setResult] = useState<InviteResult | null>(null);

  const close = () => {
    setEmail("");
    setResult(null);
    reset();
    onClose();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setResult(await api.post<InviteResult>("/workspace/invites", { email, role }));
      await onCreated();
    });
  };

  return (
    <Modal open={open} title="팀원 초대" onClose={close}>
      {result ? (
        <InviteCreated result={result} onClose={close} />
      ) : (
        <form className="stack" onSubmit={submit}>
          <Input label="이메일" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} required />
          <Select label="역할" value={role} onChange={(e) => setRole(e.target.value as Role)} hint="편집자: 가이드·검수·발송 / 승인자: 최종 승인 / 열람자: 성과·리드 보기">
            {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
          <FormError message={error} />
          <div className="row row-end">
            <Button variant="ghost" onClick={close}>취소</Button>
            <Button type="submit">초대 링크 만들기</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
