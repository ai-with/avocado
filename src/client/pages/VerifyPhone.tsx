import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Button, Input, Loader } from "../ui";
import { api, ApiError, errorMessage } from "../lib/api";
import { useMe } from "../lib/me";
import { AuthCard, FormError } from "./AuthCard";
import { safeAuthNext } from "../../shared/auth-redirect";

type SendResult = { phone: string; expiresAt: number; resendAfterSec: number; devCode?: string };
type Sent = SendResult & { sentAt: number };

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

function useNow(active: boolean) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    // 켜지는 순간 시각을 맞춘다. 안 하면 첫 화면이 화면을 연 시각 기준이라 남은 시간이 부풀어 보인다
    setT(Date.now());
    const id = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return t;
}

// 재전송 대기와 인증번호 유효 시간(초). 전송한 뒤에만 1초마다 다시 계산한다
function useCountdown(sent: Sent | null) {
  const t = useNow(!!sent);
  const resendLeft = sent ? Math.max(0, Math.ceil((sent.sentAt + sent.resendAfterSec * 1000 - t) / 1000)) : 0;
  const validLeft = sent ? Math.max(0, Math.ceil((sent.expiresAt - t) / 1000)) : 0;
  return { resendLeft, validLeft };
}

function usePhoneVerify(onDone: () => Promise<void> | void) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { resendLeft, validLeft } = useCountdown(sent);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setFields({});
    try {
      await fn();
    } catch (err) {
      setFields(err instanceof ApiError ? err.fields : {});
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const send = () =>
    run(async () => {
      const r = await api.post<SendResult>("/auth/phone/send", { phone }, { redirectOn401: false });
      setSent({ ...r, sentAt: Date.now() });
      setCode("");
    });
  const verify = (e: FormEvent) => {
    e.preventDefault();
    if (!sent) return void send();
    void run(async () => {
      await api.post("/auth/phone/verify", { phone, code }, { redirectOn401: false });
      await onDone();
    });
  };
  const changePhone = (value: string) => { setPhone(value); setSent(null); };
  return { phone, code, setCode, sent, error, fields, busy, send, verify, changePhone, resendLeft, validLeft };
}

type CodeFieldProps = { sent: Sent; code: string; setCode: (v: string) => void; validLeft: number; error?: string };

function CodeField({ sent, code, setCode, validLeft, error }: CodeFieldProps) {
  const hint = validLeft > 0 ? `${sent.phone}로 보낸 6자리를 ${mmss(validLeft)} 안에 입력해 주세요.` : "인증번호가 만료되었어요. 재전송해 주세요.";
  return (
    <>
      <Input label="인증번호" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} hint={hint} error={error} required />
      {sent.devCode && <p className="auth-dev-code">개발 모드 인증번호: <strong>{sent.devCode}</strong></p>}
    </>
  );
}

// 번호 입력 → 인증번호 전송 → 코드 입력. 가입 완료와 설정의 번호 변경에서 같이 쓴다
export function PhoneVerifyForm({ onDone, submitLabel = "인증 완료" }: { onDone: () => Promise<void> | void; submitLabel?: string }) {
  const v = usePhoneVerify(onDone);
  return (
    <form className="stack" onSubmit={v.verify}>
      <div className="row row-bottom">
        <div className="grow">
          <Input label="휴대폰 번호" type="tel" inputMode="tel" autoComplete="tel" placeholder="010-1234-5678" value={v.phone} onChange={(e) => v.changePhone(e.target.value)} error={v.fields.phone} required />
        </div>
        {v.sent && (
          <Button variant="secondary" onClick={() => void v.send()} disabled={v.busy || v.resendLeft > 0}>
            {v.resendLeft > 0 ? `재전송 ${v.resendLeft}초` : "재전송"}
          </Button>
        )}
      </div>
      {v.sent && <CodeField sent={v.sent} code={v.code} setCode={v.setCode} validLeft={v.validLeft} error={v.fields.code} />}
      <FormError message={v.error} />
      <Button type="submit" size="lg" loading={v.busy} disabled={!!v.sent && v.code.length !== 6}>{v.sent ? submitLabel : "인증번호 받기"}</Button>
      <p className="field-hint">한 번호로는 계정을 하나만 만들 수 있어요.</p>
    </form>
  );
}

export function VerifyPhonePage() {
  const [params] = useSearchParams();
  const { me, loading, refresh } = useMe();
  const next = safeAuthNext(params.get("next"));

  if (loading) return <AuthCard><Loader fill /></AuthCard>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  // 인증을 마치면 온보딩(워크스페이스 이름·설문)으로. 초대 링크로 가는 중이면 바로 초대로 간다
  if (me.phoneVerified) return <Navigate to={next.startsWith("/invite/") ? next : `/onboarding?next=${encodeURIComponent(next)}`} replace />;

  const logout = async () => {
    await api.post("/auth/logout", {}, { redirectOn401: false });
    await refresh();
  };
  return (
    <AuthCard title="휴대폰 번호 인증" description={`${me.user.email} 계정을 쓰려면 휴대폰 번호 인증이 필요해요.`}>
      <div className="mt-section"><PhoneVerifyForm onDone={async () => { await refresh(); }} /></div>
      <p className="auth-foot">
        다른 계정으로 바꾸시겠어요? <button type="button" className="link-button" onClick={() => void logout()}>로그아웃</button>
      </p>
    </AuthCard>
  );
}
