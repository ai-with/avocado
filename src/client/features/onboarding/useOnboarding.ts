import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { useMe } from "../../lib/me";
import { useSubmit } from "../../pages/useSubmit";
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
export function useSurvey(next: string) {
  const navigate = useNavigate();
  const { refresh } = useMe();
  const [state, setState] = useState<SurveyState>(EMPTY);
  const submit = useSubmit();
  const set = <K extends keyof SurveyState>(key: K, value: SurveyState[K]) => setState((s) => ({ ...s, [key]: value }));
  const send = (skipped: boolean) =>
    submit.run(async () => {
      try {
        await api.post("/workspace/onboarding", skipped ? { skipped } : toAnswers(state), { redirectOn401: false });
      } catch (e) {
        // 다른 탭에서 이미 마쳤다면 그대로 진행한다
        if (!(e instanceof ApiError && e.code === "already_onboarded")) throw e;
      }
      await refresh();
      navigate(next, { replace: true });
    });
  return { state, set, send, ...submit };
}

// 구글 가입자의 첫 워크스페이스 만들기
export function useCreateWorkspace(onCreated: () => void) {
  const { refresh } = useMe();
  const [workspaceName, setWorkspaceName] = useState("");
  const submit = useSubmit();
  const create = () =>
    submit.run(async () => {
      await api.post("/auth/onboarding", { workspaceName }, { redirectOn401: false });
      onCreated();
      await refresh();
    });
  return { workspaceName, setWorkspaceName, create, ...submit };
}
