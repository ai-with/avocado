import { useId } from "react";
import type { FieldProps } from "./Field";
import "./Form.css";
import "./Selection.css";

export type RadioOption<T extends string> = { value: T; label: string; description?: string; disabled?: boolean };

type Props<T extends string> = FieldProps & {
  label: string;
  options: RadioOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  direction?: "column" | "row";
};

// 네이티브 라디오 묶음. 화살표 키 이동·선택, Tab 한 번 진입은 브라우저 기본 동작이다
// 설명이 붙거나 선택지가 긴 하나 고르기. 짧은 선택지 2~8개는 ChoiceChips, 보기 전환은 SegmentedControl
export function RadioGroup<T extends string>({ label, hint, error, options, value, onChange, name, required, disabled, direction = "column" }: Props<T>) {
  const auto = useId();
  const groupName = name ?? auto;
  const descId = `${auto}-desc`;
  return (
    <fieldset className="fieldset-plain field radio-group" role="radiogroup" aria-required={required || undefined} aria-invalid={!!error} aria-describedby={hint || error ? descId : undefined} disabled={disabled}>
      <legend className="field-label">
        {label}
        {required && <span className="field-required" aria-hidden="true">필수</span>}
      </legend>
      <div className={direction === "row" ? "radio-list radio-list-row" : "radio-list"}>
        {options.map((o) => (
          <label key={o.value} className={o.description ? "checkbox checkbox-described" : "checkbox"}>
            <input type="radio" className="radio" name={groupName} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
            <span className="checkbox-text">
              <span>{o.label}</span>
              {o.description && <span className="checkbox-desc">{o.description}</span>}
            </span>
          </label>
        ))}
      </div>
      {error ? <p id={descId} className="field-error" role="alert">{error}</p> : hint && <p id={descId} className="field-hint">{hint}</p>}
    </fieldset>
  );
}
