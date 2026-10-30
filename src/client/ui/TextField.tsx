import type { ChangeEvent, InputHTMLAttributes, ReactNode } from "react";
import { useId, useRef, useState } from "react";
import { describedBy, Field, type FieldProps } from "./Field";
import { countChars, formatDecimalInput, formatNumberInput, normalizeDecimalInput, parseDecimalInput, parseNumberInput } from "./format";
import { Icon } from "./icons";
import "./Form.css";
import "./TextField.css";

export type ControlSize = "sm" | "md" | "lg";

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> & FieldProps & {
  size?: ControlSize;
  prefix?: ReactNode;
  suffix?: ReactNode;
  clearable?: boolean;
  onClear?: () => void;
  showCount?: boolean;
};

// 값 비우기를 사용자가 지운 것처럼 처리한다. React 가 input 이벤트를 onChange 로 받으므로 제어·비제어 모두 같은 길로 비워진다
function clearNative(input: HTMLInputElement) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}

function groupClass(size: ControlSize, { disabled, readOnly, invalid }: { disabled?: boolean; readOnly?: boolean; invalid: boolean }) {
  return ["control", "control-group", size !== "md" && `control-${size}`, disabled && "is-disabled", readOnly && "is-readonly", invalid && "is-invalid"].filter(Boolean).join(" ");
}

// Input 의 확장판: 앞뒤 단위, 지우기 버튼, 글자 수, 크기 3단, 읽기 전용 모양. 단순 입력은 Input 을 그대로 써도 된다
export function TextField({ label, hint, error, id, size = "md", prefix, suffix, clearable, onClear, showCount, className = "", onChange, ...rest }: TextFieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  const ref = useRef<HTMLInputElement>(null);
  const [inner, setInner] = useState(String(rest.defaultValue ?? ""));
  const text = rest.value === undefined ? inner : String(rest.value);
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInner(e.target.value);
    onChange?.(e);
  };
  const canClear = clearable && text !== "" && !rest.disabled && !rest.readOnly;
  const count = showCount ? { current: countChars(text), max: rest.maxLength } : undefined;
  return (
    <Field id={fid} label={label} hint={hint} error={error} required={rest.required} count={count}>
      <div className={`${groupClass(size, { disabled: rest.disabled, readOnly: rest.readOnly, invalid: !!error })} ${className}`.trim()}>
        {prefix && <span className="control-affix">{prefix}</span>}
        <input ref={ref} id={fid} className="control-input" aria-invalid={!!error} aria-describedby={describedBy(fid, { hint, error }, showCount)} onChange={handleChange} {...rest} />
        {canClear && (
          <button type="button" className="control-clear" aria-label="입력 내용 지우기" onClick={() => { if (ref.current) clearNative(ref.current); onClear?.(); }}>
            <Icon name="x" size={12} />
          </button>
        )}
        {suffix && <span className="control-affix">{suffix}</span>}
      </div>
    </Field>
  );
}

type NumberFieldProps = Omit<TextFieldProps, "value" | "defaultValue" | "onChange" | "type" | "inputMode"> & {
  value: number | null;
  onChange: (value: number | null) => void;
  /** 소수 허용. 숫자와 점 하나만 받고 쉼표는 정수 부분에만 붙는다 */
  decimal?: boolean;
  /** 소수 자리 최대 개수. 주면 decimal 이 켜진 것으로 본다 */
  maxDecimals?: number;
};

// 금액·수량. 화면에는 천 단위 쉼표, 바깥으로는 숫자(비면 null). 음수는 받지 않고, 소수는 decimal 일 때만
// ponytail: 가운데를 고치면 쉼표가 다시 붙으며 커서가 끝으로 간다. 긴 숫자 중간 편집이 잦아지면 커서 위치 보정을 넣는다
export function NumberField({ value, onChange, decimal, maxDecimals, ...rest }: NumberFieldProps) {
  if (decimal || maxDecimals !== undefined) return <DecimalField {...rest} value={value} onChange={onChange} maxDecimals={maxDecimals} />;
  return <TextField {...rest} type="text" inputMode="numeric" autoComplete="off" value={formatNumberInput(value)} onChange={(e) => onChange(parseNumberInput(e.target.value))} />;
}

// "12." 처럼 값으로는 같지만 글자가 다른 중간 상태를 지키려고 표시 글자를 따로 든다. 바깥 값이 바뀌면 그 값으로 다시 그린다
function DecimalField({ value, onChange, maxDecimals, ...rest }: Omit<NumberFieldProps, "decimal">) {
  const [text, setText] = useState(() => formatDecimalInput(value));
  const shown = parseDecimalInput(text) === value ? text : formatDecimalInput(value);
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = normalizeDecimalInput(e.target.value, maxDecimals);
    if (next === null) return; // 받을 수 없는 글자는 그대로 무시(제어 입력이라 이전 글자로 돌아간다)
    setText(next);
    onChange(parseDecimalInput(next));
  };
  return <TextField {...rest} type="text" inputMode="decimal" autoComplete="off" value={shown} onChange={handleChange} />;
}

type SearchFieldProps = Omit<TextFieldProps, "type" | "prefix" | "label"> & { label: string; showLabel?: boolean };

// 검색칸. 앞에 돋보기, 값이 있으면 지우기. 라벨은 기본으로 화면 낭독기에만(FilterBar 안), showLabel 이면 위에 보인다
export function SearchField({ label, showLabel, clearable = true, ...rest }: SearchFieldProps) {
  return (
    <TextField
      {...rest}
      type="search"
      enterKeyHint="search"
      clearable={clearable}
      label={showLabel ? label : undefined}
      aria-label={showLabel ? undefined : label}
      prefix={<Icon name="search" size={16} />}
    />
  );
}
