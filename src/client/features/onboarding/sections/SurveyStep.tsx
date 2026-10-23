import type { FormEvent } from "react";
import { Button, ChoiceChips, Input } from "../../../ui";
import { FormError } from "../../../pages/AuthCard";
import { GOALS, ROLES, TEAM_SIZES } from "../../../../shared/onboarding";
import { useSurvey } from "../useOnboarding";

// 2단계: 팀 규모·역할·목표·경로·웹사이트. 모두 선택 사항이라 바로 "시작하기"를 눌러도 된다
export function SurveyStep({ next }: { next: string }) {
  const s = useSurvey(next);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void s.send(false);
  };
  return (
    <>
      <h1 className="onboarding-title">조금 더 알려 주세요</h1>
      <p className="onboarding-desc">답변에 맞춰 시작 안내를 바꿔 드려요.</p>
      <form className="stack onboarding-form" onSubmit={onSubmit}>
        <ChoiceChips label="팀 규모" options={[...TEAM_SIZES]} value={s.state.teamSize} onChange={(v) => s.set("teamSize", v)} />
        <ChoiceChips label="역할" options={[...ROLES]} value={s.state.role} onChange={(v) => s.set("role", v)} />
        <ChoiceChips label="주 목표" hint="여러 개 고를 수 있어요." multiple options={[...GOALS]} value={s.state.goals} onChange={(v) => s.set("goals", v)} />
        <Input label="알게 된 경로" placeholder="예: 지인 추천, 검색, 인스타그램" maxLength={100} value={s.state.source} onChange={(e) => s.set("source", e.target.value)} error={s.fields.source} />
        <Input label="회사 웹사이트" type="url" placeholder="https://" autoComplete="url" value={s.state.website} onChange={(e) => s.set("website", e.target.value)} error={s.fields.website} />
        <FormError message={s.error} />
        <Button type="submit" className="onboarding-submit" disabled={s.busy}>시작하기</Button>
        <button type="button" className="link-button onboarding-skip" disabled={s.busy} onClick={() => void s.send(true)}>나중에 하기</button>
      </form>
    </>
  );
}
