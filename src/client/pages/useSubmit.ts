import { useState } from "react";
import { ApiError, errorMessage } from "../lib/api";

// 폼 제출 공통 상태: 진행 중 표시, 폼 오류, 서버가 돌려준 필드별 오류
export function useSubmit(initialError = "") {
  const [error, setError] = useState(initialError);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setFields(err instanceof ApiError ? err.fields : {});
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setError("");
    setFields({});
  };
  return { error, fields, busy, run, reset };
}
