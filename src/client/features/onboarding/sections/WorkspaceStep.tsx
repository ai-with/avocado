import type { FormEvent } from "react";
import { Button, Input } from "../../../ui";
import { FormError } from "../../../pages/AuthCard";
import { useCreateWorkspace } from "../useOnboarding";

// 1단계: 워크스페이스가 없는 구글 가입자만 본다
export function WorkspaceStep({ onCreated }: { onCreated: () => void }) {
  const w = useCreateWorkspace(onCreated);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void w.create();
  };
  return (
    <>
      <h1 className="onboarding-title">워크스페이스 이름이 무엇인가요?</h1>
      <p className="onboarding-desc">브랜드나 회사 이름이면 충분해요. 나중에 설정에서 바꿀 수 있어요.</p>
      <form className="stack onboarding-form" onSubmit={onSubmit}>
        <Input label="워크스페이스 이름" autoComplete="organization" maxLength={60} value={w.workspaceName} onChange={(e) => w.setWorkspaceName(e.target.value)} error={w.fields.workspaceName} required />
        <FormError message={w.error} />
        <Button type="submit" className="onboarding-submit" disabled={w.busy}>다음</Button>
      </form>
    </>
  );
}
