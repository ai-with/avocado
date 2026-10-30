import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Input, Loader, Tabs, TextField } from "../ui";
import { api, errorMessage } from "../lib/api";
import { useMe } from "../lib/me";
import { ROLE_LABELS, type Role } from "../../shared/roles";
import { withJosa } from "../../shared/josa";
import { AuthCard, FormError } from "./AuthCard";
import { useSubmit } from "./useSubmit";

type InviteInfo = { workspaceName: string; email: string; role: Role; expiresAt: number };
type Mode = "signup" | "login";

// 요청을 실행하고 성공하면 내 정보를 새로 받아 홈으로 보낸다
function useRunThenHome() {
  const navigate = useNavigate();
  const { refresh } = useMe();
  const { error, fields, busy, run: runSubmit } = useSubmit();
  const run = (fn: () => Promise<unknown>) =>
    runSubmit(async () => {
      await fn();
      await refresh();
      navigate("/dashboard", { replace: true });
    });
  return { error, fields, busy, run };
}

function AcceptSection({ token }: { token: string }) {
  const { error, busy, run } = useRunThenHome();
  const accept = () => run(() => api.post(`/invites/${token}/accept`, {}, { redirectOn401: false }));
  return (
    <div className="stack mt-section">
      <FormError message={error} />
      <Button size="lg" onClick={() => void accept()} loading={busy}>초대 수락하기</Button>
    </div>
  );
}

function OtherAccountSection({ email }: { email: string }) {
  const { refresh } = useMe();
  const logout = async () => {
    await api.post("/auth/logout");
    await refresh();
  };
  return (
    <div className="stack mt-section">
      <p>지금 {email} 계정으로 로그인되어 있어요. 초대받은 이메일로 다시 로그인해 주세요.</p>
      <Button variant="secondary" onClick={() => void logout()}>로그아웃</Button>
    </div>
  );
}

function JoinForm({ token, invite }: { token: string; invite: InviteInfo }) {
  const [mode, setMode] = useState<Mode>("signup");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const { error, fields, busy, run } = useRunThenHome();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (mode === "signup") {
        await api.post("/auth/signup", { name, email: invite.email, password, inviteToken: token }, { redirectOn401: false });
      } else {
        await api.post("/auth/login", { email: invite.email, password }, { redirectOn401: false });
        await api.post(`/invites/${token}/accept`, {}, { redirectOn401: false });
      }
    });
  };
  const signup = mode === "signup";
  return (
    <form className="stack" onSubmit={submit}>
      <Tabs tabs={[{ value: "signup", label: "새로 가입" }, { value: "login", label: "기존 계정으로 로그인" }]} value={mode} onChange={setMode} />
      <TextField label="이메일" type="email" autoComplete="email" value={invite.email} readOnly />
      {signup && <Input label="이름" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} required />}
      <Input label="비밀번호" type="password" autoComplete={signup ? "new-password" : "current-password"} hint={signup ? "8자 이상" : undefined} value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} required />
      <FormError message={error} />
      <Button type="submit" size="lg" loading={busy}>{signup ? "가입하고 참여하기" : "로그인하고 참여하기"}</Button>
    </form>
  );
}

export function InviteAcceptPage() {
  const { token = "" } = useParams();
  const { me, loading } = useMe();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    api
      .get<InviteInfo>(`/invites/${token}`, { redirectOn401: false })
      .then(setInvite)
      .catch((e: unknown) => setLoadError(errorMessage(e)));
  }, [token]);

  if (loadError) return <AuthCard title="초대를 열 수 없어요" description={loadError} />;
  if (!invite || loading) return <AuthCard><Loader fill label="초대 정보를 불러오는 중이에요" /></AuthCard>;

  const sameUser = me?.user.email === invite.email;
  return (
    <AuthCard title={`${invite.workspaceName} 팀 초대`} description={`${invite.email} 님을 ${withJosa(ROLE_LABELS[invite.role], "으로/로")} 초대했어요.`}>
      {me && sameUser && <AcceptSection token={token} />}
      {me && !sameUser && <OtherAccountSection email={me.user.email} />}
      {!me && <JoinForm token={token} invite={invite} />}
    </AuthCard>
  );
}
