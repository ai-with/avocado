import { useEffect, useState } from "react";
import { Button } from "../ui";
import { api } from "../lib/api";

// 구글 오류 코드(콜백이 /login?error= 로 넘김) → 안내 문구
export const GOOGLE_ERRORS: Record<string, string> = {
  google_disabled: "구글 로그인은 준비 중이에요. 이메일로 로그인해 주세요.",
  google_state: "로그인 요청이 만료되었어요. 다시 시도해 주세요.",
  google_cancelled: "구글 로그인을 취소했어요.",
  google_failed: "구글 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.",
  google_email_unverified: "같은 이메일로 가입한 계정이 있어요. 이메일과 비밀번호로 로그인해 주세요.",
};

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

// "Google로 계속하기" + "또는" 구분선. 서버에 구글 키가 없으면 비활성
export function GoogleSection({ next = "/dashboard" }: { next?: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .get<{ google: boolean }>("/auth/config", { redirectOn401: false })
      .then((r) => setEnabled(r.google))
      .catch(() => setEnabled(false));
  }, []);
  return (
    <div className="stack auth-google">
      <Button
        variant="secondary"
        className="auth-google-btn"
        disabled={!enabled}
        onClick={() => location.assign(`/api/auth/google/start?next=${encodeURIComponent(next)}`)}
      >
        <GoogleLogo />
        Google로 계속하기
      </Button>
      {enabled === false && <p className="field-hint">구글 로그인은 준비 중이에요.</p>}
      <div className="auth-divider"><span>또는 이메일로</span></div>
    </div>
  );
}
