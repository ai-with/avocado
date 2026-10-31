import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { useMe } from "../../lib/me";
import { useSubmit } from "../../pages/useSubmit";
import { needsOnboarding } from "../../../shared/roles";
import type { Goal, OnboardingAnswers, OnboardingRole, TeamSize } from "../../../shared/onboarding";

export type SurveyState = { teamSize: TeamSize | null; role: OnboardingRole | null; goals: Goal[]; source: string; website: string };

const EMPTY: SurveyState = { teamSize: null, role: null, goals: [], source: "", website: "" };

// 비어 있는 답은 보내지 않는다
function toAnswers(s: SurveyState): OnboardingAnswers {
  return {
    ...(s.teamSize && { teamSize: s.teamSize }),
    ...(s.role && { role: s.role }),
    ...(s.goals.length > 0 && { goals: s.goals }),
    ...(s.source.trim() && { source: s.source.trim() }),
    ...(s.website.trim() && { website: s.website.trim() }),
  };
}

// 설문 답 상태와 제출. 완료·건너뛰기 모두 me 를 새로 받아 게이트를 풀고 next 로 간다
export function useSurvey(next: string, expectedWorkspaceId: string) {
  const navigate = useNavigate();
  const { me, refresh } = useMe();
  const userId = me?.user.id;
  const pending = useRef(false);
  const [state, setState] = useState<SurveyState>(EMPTY);
  const submit = useSubmit();
  const set = <K extends keyof SurveyState>(key: K, value: SurveyState[K]) => setState((s) => ({ ...s, [key]: value }));
  const send = (skipped: boolean) => {
    if (pending.current) return Promise.resolve();
    pending.current = true;
    return submit.run(async () => {
      try {
        await api.post("/workspace/onboarding", { ...(skipped ? { skipped } : toAnswers(state)), expectedWorkspaceId, expectedUserId: userId }, { redirectOn401: false });
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "already_onboarded")) { await refresh(); throw error; }
      }
      const current = await refresh();
      if (current && current.user.id === userId && current.workspace?.id === expectedWorkspaceId && !needsOnboarding(current.workspace, current.role)) navigate(next, { replace: true });
    }).finally(() => { pending.current = false; });
  };
  return { state, set, send, ...submit };
}

// 구글 가입자의 첫 워크스페이스 만들기
export function useCreateWorkspace(onCreated: () => void) {
  const { me, refresh } = useMe();
  const [workspaceName, setWorkspaceName] = useState("");
  const submit = useSubmit();
  const create = () =>
    submit.run(async () => {
      try { await api.post("/auth/onboarding", { workspaceName, expectedUserId: me?.user.id }, { redirectOn401: false }); }
      catch (error) {
        if (!(error instanceof ApiError && error.code === "has_workspace")) { await refresh(); throw error; }
      }
      onCreated();
      await refresh();
    });
  return { workspaceName, setWorkspaceName, create, ...submit };
}

export function useMemberSkip(next: string, expectedWorkspaceId: string) {
  const { me, refresh } = useMe(), navigate = useNavigate(), submit = useSubmit(), pending = useRef(false);
  const userId = me?.user.id;
  const skip = () => {
    if (pending.current) return Promise.resolve();
    pending.current = true;
    return submit.run(async () => {
      try { await api.post("/workspace/onboarding/skip", { expectedWorkspaceId, expectedUserId: userId }, { redirectOn401: false }); }
      catch (error) { await refresh(); throw error; }
      const current = await refresh();
      if (current && current.user.id === userId && current.workspace?.id === expectedWorkspaceId && !needsOnboarding(current.workspace, current.role)) navigate(next, { replace: true });
    }).finally(() => { pending.current = false; });
  };
  return { skip, ...submit };
}
