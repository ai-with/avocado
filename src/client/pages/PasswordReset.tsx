import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Input } from "../ui";
import { api } from "../lib/api";
import { AuthCard, FormError } from "./AuthCard";
import { useSubmit } from "./useSubmit";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const { error, busy, run } = useSubmit();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.post("/auth/password/forgot", { email }, { redirectOn401: false });
      setDone(true);
    });
  };

  const description = done
    ? "가입된 이메일이면 재설정 링크를 보냈어요. 30분 안에 메일의 링크를 눌러 주세요."
    : "가입한 이메일로 비밀번호 재설정 링크를 보내 드려요.";
  return (
    <AuthCard title="비밀번호 찾기" description={description}>
      {!done && (
        <form className="stack" onSubmit={submit}>
          <Input label="이메일" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <FormError message={error} />
          <Button type="submit" size="lg" loading={busy}>재설정 링크 받기</Button>
        </form>
      )}
      <p className="auth-foot"><Link to="/login">로그인으로 돌아가기</Link></p>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const { token = "" } = useParams();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const { error, fields, busy, run } = useSubmit();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.post("/auth/password/reset", { token, password }, { redirectOn401: false });
      setDone(true);
    });
  };

  const description = done ? "비밀번호를 바꿨어요. 다른 기기의 로그인은 모두 끊었어요. 새 비밀번호로 로그인해 주세요." : undefined;
  return (
    <AuthCard title="새 비밀번호 정하기" description={description}>
      {!done && (
        <form className="stack" onSubmit={submit}>
          <Input label="새 비밀번호" type="password" autoComplete="new-password" hint="8자 이상" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} required />
          <FormError message={error} />
          <Button type="submit" size="lg" loading={busy}>비밀번호 바꾸기</Button>
        </form>
      )}
      <p className="auth-foot"><Link to="/login">로그인으로 이동</Link></p>
    </AuthCard>
  );
}
