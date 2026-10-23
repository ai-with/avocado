import { useId, type KeyboardEvent } from "react";
import "./ChoiceChips.css";

export type ChoiceOption<T extends string> = { value: T; label: string };

type SingleProps<T extends string> = { multiple?: false; value: T | null; onChange: (value: T) => void };
type MultiProps<T extends string> = { multiple: true; value: T[]; onChange: (value: T[]) => void };
type Props<T extends string> = { options: ChoiceOption<T>[]; label: string; hint?: string } & (SingleProps<T> | MultiProps<T>);

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

// 알약 모양 선택지. 하나만 고르면 라디오 그룹(화살표로 이동하며 선택), 여러 개면 체크박스 묶음(Tab 이동, Space 토글)
export function ChoiceChips<T extends string>(props: Props<T>) {
  const { options, label, hint } = props;
  const labelId = useId();
  const isOn = (v: T) => (props.multiple ? props.value.includes(v) : props.value === v);
  const toggle = (v: T) => {
    if (!props.multiple) return props.onChange(v);
    props.onChange(isOn(v) ? props.value.filter((x) => x !== v) : [...props.value, v]);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = STEP[e.key];
    if (props.multiple || !step) return;
    e.preventDefault();
    const index = options.findIndex((o) => o.value === props.value);
    const next = options[(index + step + options.length) % options.length];
    if (!next) return;
    props.onChange(next.value);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  };
  // 라디오 그룹은 선택된 칩(없으면 첫 칩)만 Tab 으로 들어온다
  const tabStop = props.multiple ? null : props.value ?? options[0]?.value;

  return (
    <div className="chips-field">
      <span id={labelId} className="field-label">{label}</span>
      {hint && <span className="field-hint">{hint}</span>}
      <div className="chips" role={props.multiple ? "group" : "radiogroup"} aria-labelledby={labelId} onKeyDown={onKeyDown}>
        {options.map((o) => (
          <button key={o.value} type="button" data-value={o.value} className="chip" role={props.multiple ? "checkbox" : "radio"} aria-checked={isOn(o.value)} tabIndex={tabStop === null || tabStop === o.value ? 0 : -1} onClick={() => toggle(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
