import { useState, type FormEvent } from "react";
import { ApiError, errorMessage } from "../../lib/api";
import { isFreeEmail } from "../../../shared/leads";
import type { VisitorValues } from "./VisitorForm";

type Options = { companyEmailOnly?: boolean; preview?: boolean; onSubmit?: (v: VisitorValues) => Promise<void> };

// 방문자 입력값, 제출 전 검사(회사 이메일, 필수 동의), 서버 필드 오류 표시
export function useVisitorForm({ companyEmailOnly, preview, onSubmit }: Options) {
  const [v, setV] = useState<VisitorValues>({ email: "", answers: {}, privacyAgreed: false, marketingOptIn: false, alimtalkOptIn: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<VisitorValues>) => setV((p) => ({ ...p, ...patch }));
  const answer = (id: string, a: string | string[]) => setV((p) => ({ ...p, answers: { ...p.answers, [id]: a } }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (preview || !onSubmit) return;
    if (companyEmailOnly && isFreeEmail(v.email)) return setErrors({ email: "회사 이메일로 입력해 주세요." });
    if (!v.privacyAgreed) return setErrors({ privacyAgreed: "개인정보 수집·이용에 동의해야 제출할 수 있어요." });
    setBusy(true);
    setErrors({});
    try {
      await onSubmit(v);
    } catch (err) {
      setErrors(err instanceof ApiError && Object.keys(err.fields).length ? err.fields : { _: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return { v, set, answer, errors, busy, submit };
}
