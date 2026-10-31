import { useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { Loader } from "../../ui";
import { api } from "../../lib/api";
import { useMe } from "../../lib/me";
import { BRAND } from "../../pages/landing/copy";
import { WorkspaceStep } from "./sections/WorkspaceStep";
import { SurveyStep } from "./sections/SurveyStep";
import { safeAuthNext } from "../../../shared/auth-redirect";
import "./onboarding.css";

function TopBar({ email, onLogout }: { email: string; onLogout: () => void }) {
  return (
    <div className="onboarding-top">
      <button type="button" className="link-button" onClick={onLogout}>로그아웃</button>
      <span className="text-secondary">{email}로 로그인됨</span>
    </div>
  );
}

// 가입 직후 한 번 거치는 화면: (구글 가입자만) 워크스페이스 이름 → 설문
export function OnboardingPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const { me, loading, refresh } = useMe();
  // 1단계를 거쳐 온 사람에게만 "2/2"를 보여 준다
  const [createdHere, setCreatedHere] = useState(false);
  const next = safeAuthNext(params.get("next"));
  const here = encodeURIComponent(location.pathname + location.search);

  if (loading) return <div className="onboarding"><Loader fill /></div>;
  if (!me) return <Navigate to={`/login?next=${here}`} replace />;
  if (!me.phoneVerified) return <Navigate to={`/verify-phone?next=${here}`} replace />;
  const needsWorkspace = me.workspaces.length === 0;
  // 초대를 받으러 가는 중이면 워크스페이스를 만들지 않는다. 이미 마친 워크스페이스는 설문을 다시 묻지 않는다
  if ((needsWorkspace && next.startsWith("/invite/")) || me.workspace?.onboardedAt) return <Navigate to={next} replace />;

  const logout = async () => {
    await api.post("/auth/logout", {}, { redirectOn401: false });
    await refresh();
  };
  const stepLabel = needsWorkspace ? "1/2" : createdHere ? "2/2" : null;
  return (
    <div className="onboarding">
      <TopBar email={me.user.email} onLogout={() => void logout()} />
      <main className="onboarding-main">
        <Link to="/" className="onboarding-logo">{BRAND}</Link>
        {stepLabel && <p className="onboarding-step text-caption">{stepLabel}</p>}
        {needsWorkspace ? <WorkspaceStep onCreated={() => setCreatedHere(true)} /> : <SurveyStep next={next} />}
      </main>
    </div>
  );
}
