import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import "./Form.css";

type FieldProps = { label?: string; hint?: string; error?: string };
type FieldShellProps = FieldProps & { id: string; required?: boolean; children: ReactNode };

// 라벨, 필수 표시, 도움말·오류를 한 묶음으로. 도움말과 오류는 aria-describedby 로 입력칸에 연결된다
function Field({ id, label, hint, error, required, children }: FieldShellProps) {
  return (
    <div className="field">
      {label && (
        <label htmlFor={id} className="field-label">
          {label}
          {required && <span className="field-required" aria-hidden="true">필수</span>}
        </label>
      )}
      {children}
      {error ? <p id={`${id}-desc`} className="field-error" role="alert">{error}</p> : hint && <p id={`${id}-desc`} className="field-hint">{hint}</p>}
    </div>
  );
}

const describedBy = (id: string, { hint, error }: FieldProps) => (hint || error ? `${id}-desc` : undefined);

export function Input({ label, hint, error, id, ...rest }: InputHTMLAttributes<HTMLInputElement> & FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field id={fid} label={label} hint={hint} error={error} required={rest.required}>
      <input id={fid} className="control" aria-invalid={!!error} aria-describedby={describedBy(fid, { hint, error })} {...rest} />
    </Field>
  );
}

export function Textarea({ label, hint, error, id, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field id={fid} label={label} hint={hint} error={error} required={rest.required}>
      <textarea id={fid} className="control control-textarea" aria-invalid={!!error} aria-describedby={describedBy(fid, { hint, error })} {...rest} />
    </Field>
  );
}

export function Select({ label, hint, error, id, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field id={fid} label={label} hint={hint} error={error} required={rest.required}>
      <select id={fid} className="control" aria-invalid={!!error} aria-describedby={describedBy(fid, { hint, error })} {...rest}>{children}</select>
    </Field>
  );
}

export function Checkbox({ label, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}
