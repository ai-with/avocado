import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Input } from "../ui";
import { api } from "../lib/api";
import { useMe } from "../lib/me";
import { GoogleSection } from "./AuthGoogle";
import { AuthCard, FormError } from "./AuthCard";
import { useSubmit } from "./useSubmit";

export function SignupPage() {
  const navigate = useNavigate();
  const { refresh } = useMe();
  const [form, setForm] = useState({ name: "", email: "", password: "", workspaceName: "" });
  const { error, fields, busy, run } = useSubmit();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.post("/auth/signup", form, { redirectOn401: false });
      await refresh();
      navigate("/verify-phone", { replace: true });
    });
  };

  return (
    <AuthCard title="가입하기" description="워크스페이스를 만들고 팀을 초대할 수 있어요. 가입 후 휴대폰 번호 인증이 필요해요.">
      <GoogleSection />
      <form className="stack" onSubmit={submit}>
        <Input label="이름" autoComplete="name" value={form.name} onChange={set("name")} error={fields.name} required />
        <Input label="이메일" type="email" autoComplete="email" value={form.email} onChange={set("email")} error={fields.email} required />
        <Input label="비밀번호" type="password" autoComplete="new-password" hint="8자 이상" value={form.password} onChange={set("password")} error={fields.password} required />
        <Input label="워크스페이스 이름" autoComplete="organization" hint="브랜드나 회사 이름을 적어 주세요." value={form.workspaceName} onChange={set("workspaceName")} error={fields.workspaceName} required />
        <FormError message={error} />
        <Button type="submit" disabled={busy}>가입하기</Button>
      </form>
      <p className="auth-foot">
        이미 계정이 있으신가요? <Link to="/login">로그인</Link>
      </p>
    </AuthCard>
  );
}
