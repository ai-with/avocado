import type { ReactNode } from "react";
import { countLabel } from "./format";

export type FieldProps = { label?: string; hint?: string; error?: string };
export type FieldCount = { current: number; max?: number };
type FieldShellProps = FieldProps & { id: string; required?: boolean; fit?: boolean; count?: FieldCount; children: ReactNode };

// 라벨, 필수 표시, 도움말·오류, 글자 수를 한 묶음으로. 도움말·오류·글자 수는 aria-describedby 로 입력칸에 연결된다
export function Field({ id, label, hint, error, required, fit, count, children }: FieldShellProps) {
  const message = error ? <p id={`${id}-desc`} className="field-error" role="alert">{error}</p> : hint && <p id={`${id}-desc`} className="field-hint">{hint}</p>;
  return (
    <div className={fit ? "field field-fit" : "field"}>
      {label && (
        <label htmlFor={id} className="field-label">
          {label}
          {required && <span className="field-required" aria-hidden="true">필수</span>}
        </label>
      )}
      {children}
      {count ? (
        <div className="field-foot">
          {message || <span />}
          <span id={`${id}-count`} className={count.max !== undefined && count.current > count.max ? "field-count field-count-over" : "field-count"}>
            {countLabel(count.current, count.max)}
          </span>
        </div>
      ) : message}
    </div>
  );
}

export function describedBy(id: string, { hint, error }: FieldProps, hasCount = false): string | undefined {
  const ids = [hint || error ? `${id}-desc` : "", hasCount ? `${id}-count` : ""].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}
