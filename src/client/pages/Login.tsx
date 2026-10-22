import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input } from "../ui";
import { api } from "../lib/api";
import { useMe } from "../lib/me";
import { GOOGLE_ERRORS, GoogleSection } from "./AuthGoogle";
import { AuthCard, FormError } from "./AuthCard";
import { useSubmit } from "./useSubmit";

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { error, fields, busy, run } = useSubmit(GOOGLE_ERRORS[params.get("error") ?? ""] ?? "");
  const next = params.get("next") || "/";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.post("/auth/login", { email, password }, { redirectOn401: false });
      await refresh();
      // 휴대폰 인증 전이면 AppShell 이 /verify-phone 으로 보낸다
      navigate(next, { replace: true });
    });
  };

  return (
    <AuthCard title="로그인" description="구글 계정이나 이메일로 로그인해 주세요.">
      <GoogleSection next={next} />
      <form className="stack" onSubmit={submit}>
        <Input label="이메일" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} required />
        <Input label="비밀번호" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} required />
        <FormError message={error} />
        <Button type="submit" disabled={busy}>로그인</Button>
        <Link to="/forgot-password" className="auth-forgot">비밀번호를 잊으셨나요?</Link>
      </form>
      <p className="auth-foot">
        처음이신가요? <Link to="/signup">가입하기</Link>
      </p>
    </AuthCard>
  );
}
