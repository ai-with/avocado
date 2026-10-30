import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId, useLayoutEffect, useRef } from "react";
import { describedBy, Field, type FieldProps } from "./Field";
import { countChars } from "./format";
import "./Form.css";

export function Input({ label, hint, error, id, ...rest }: InputHTMLAttributes<HTMLInputElement> & FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field id={fid} label={label} hint={hint} error={error} required={rest.required}>
      <input id={fid} className="control" aria-invalid={!!error} aria-describedby={describedBy(fid, { hint, error })} {...rest} />
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

type SelectSize = "sm" | "md" | "lg";
const SELECT_CLASS: Record<SelectSize, string> = { sm: "control control-sm", md: "control", lg: "control control-lg" };

// size="sm": 표 안·줄 안에 놓는 작은 선택칸. 폭은 내용에 맞고 화살표 자리는 항상 확보된다. size="lg": TextField lg 와 같은 높이
export function Select({ label, hint, error, id, size = "md", children, ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & FieldProps & { size?: SelectSize }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field id={fid} label={label} hint={hint} error={error} required={rest.required} fit={size === "sm"}>
      <select id={fid} className={SELECT_CLASS[size]} aria-invalid={!!error} aria-describedby={describedBy(fid, { hint, error })} {...rest}>{children}</select>
    </Field>
  );
}

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
