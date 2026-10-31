import { Button } from "../../../ui";
import { FormError } from "../../../pages/AuthCard";
import { useMemberSkip } from "../useOnboarding";

export function MemberSkipStep({ next, expectedWorkspaceId }: { next: string; expectedWorkspaceId: string }) {
  const { skip, busy, error } = useMemberSkip(next, expectedWorkspaceId);
  return <div className="stack onboarding-form">
    <h1 className="onboarding-title">워크스페이스에 참여했어요</h1>
    <p className="onboarding-desc">설문은 소유자가 답해요. 건너뛰고 바로 시작할 수 있어요.</p>
    <FormError message={error} />
    <Button onClick={() => void skip()} loading={busy}>건너뛰고 시작하기</Button>
  </div>;
}
