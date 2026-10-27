import { useState } from "react";
import { api, errorMessage } from "../../lib/api";
import type { VisitorValues } from "../forms/VisitorForm";

// 게이트 통과 증표(열람 토큰)는 자료 링크마다 이 브라우저에 둔다. 저장이 막힌 브라우저면 이번 화면에서만 쓴다
const unlockKey = (slug: string) => `doc-unlock:${slug}`;

export function readUnlock(slug: string): string {
  try {
    return localStorage.getItem(unlockKey(slug)) ?? "";
  } catch {
    return "";
  }
}

export function saveUnlock(slug: string, token: string) {
  try {
    localStorage.setItem(unlockKey(slug), token);
  } catch {
    // 시크릿 창 등 저장 불가: 새로고침하면 다시 묻는다
  }
}

type GateResult = { status: "passed"; unlockToken: string } | { status: "verify_sent"; email: string };

// 게이트 제출과 인증 메일 다시 보내기. 통과하면 토큰을 저장하고 onUnlock 으로 본문을 다시 받는다
export function useDocGate(slug: string, viewToken: string, onUnlock: (token: string) => Promise<void>) {
  const [pendingEmail, setPendingEmail] = useState("");
  const [resendMsg, setResendMsg] = useState("");
  const [resending, setResending] = useState(false);

  const submit = async (values: VisitorValues) => {
    const r = await api.post<GateResult>(`/public/doc/${slug}/gate`, { ...values, viewToken }, { redirectOn401: false });
    if (r.status === "verify_sent") return setPendingEmail(r.email);
    saveUnlock(slug, r.unlockToken);
    await onUnlock(r.unlockToken);
  };

  const resend = async () => {
    setResending(true);
    try {
      await api.post(`/public/doc/${slug}/gate/resend`, { viewToken }, { redirectOn401: false });
      setResendMsg("인증 메일을 다시 보냈어요.");
    } catch (e) {
      setResendMsg(errorMessage(e));
    } finally {
      setResending(false);
    }
  };

  return { submit, pendingEmail, resend, resendMsg, resending };
}
