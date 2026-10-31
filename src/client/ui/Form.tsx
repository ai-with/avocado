import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { useId, useLayoutEffect, useRef } from "react";
import { describedBy, Field, type FieldProps } from "./Field";
import { countChars } from "./format";
import { SelectCustom } from "./SelectCustom";
import "./Form.css";

// size="sm": 표 안·필터 줄·툴바 같은 촘촘한 자리(32). 기본은 TDS box 56
export function Input({ label, hint, error, id, size = "md", className = "", ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & FieldProps & { size?: "sm" | "md" }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field id={fid} label={label} hint={hint} error={error} required={rest.required}>
      <input id={fid} className={`control ${size === "sm" ? "control-sm" : ""} ${className}`.trim()} aria-invalid={!!error} aria-describedby={describedBy(fid, { hint, error })} {...rest} />
    </Field>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps & { autoGrow?: boolean; showCount?: boolean };

// autoGrow: 내용만큼 높이가 늘어난다(최소 높이는 그대로). showCount: 아래 오른쪽에 글자 수, maxLength 가 있으면 "n/최대"
export function Textarea({ label, hint, error, id, autoGrow, showCount, className = "", onInput, ...rest }: TextareaProps) {
  const auto = useId();
  const fid = id ?? auto;
  const ref = useRef<HTMLTextAreaElement>(null);
  const grow = () => {
    const el = ref.current;
    if (!autoGrow || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  };
  useLayoutEffect(grow, [autoGrow, rest.value]);
  const text = String(rest.value ?? rest.defaultValue ?? "");
  const count = showCount ? { current: countChars(text), max: rest.maxLength } : undefined;
  return (
    <Field id={fid} label={label} hint={hint} error={error} required={rest.required} count={count}>
      <textarea ref={ref} id={fid} className={`control control-textarea ${autoGrow ? "control-autogrow" : ""} ${className}`.trim()} aria-invalid={!!error} aria-describedby={describedBy(fid, { hint, error }, showCount)} onInput={(e) => { grow(); onInput?.(e); }} {...rest} />
    </Field>
  );
}

// 모든 크기가 시스템 목록이 아니라 SelectMenu 의 직접 그린 목록으로 열린다(다른 드롭다운과 같은 모양)
// size="sm": 표 안·줄 안에 놓는 작은 선택칸(32, 폭은 내용만큼). 기본 md(56). size="lg": TextField lg 와 같은 높이
export const Select = SelectCustom;

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; description?: ReactNode; indeterminate?: boolean };

// indeterminate: "일부만 고름"(전체 선택 칸). HTML 속성이 없어 DOM 속성으로 넣는다
export function Checkbox({ label, description, indeterminate = false, ...rest }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  const descId = useId();
  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className={description ? "checkbox checkbox-described" : "checkbox"}>
      <input ref={ref} type="checkbox" aria-describedby={description ? descId : undefined} {...rest} />
      {description ? (
        <span className="checkbox-text">
          <span>{label}</span>
          <span id={descId} className="checkbox-desc">{description}</span>
        </span>
      ) : <span>{label}</span>}
    </label>
  );
}
