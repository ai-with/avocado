import { useId } from "react";
import "./Selection.css";

export type SegmentOption<T extends string> = { value: T; label: string; disabled?: boolean };

type Props<T extends string> = {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  fluid?: boolean;
  disabled?: boolean;
};

// 같은 내용을 다르게 보기(기간 7일·30일, 표·카드). 화면 전환은 Tabs, 값 입력은 ChoiceChips
// 안쪽은 숨긴 네이티브 라디오라 화살표 키 이동·선택이 기본 동작이다. 라벨은 화면 낭독기에만 읽힌다
// fluid: 칸 폭을 글자에 맞춘다. 기본은 모든 칸 같은 폭
export function SegmentedControl<T extends string>({ label, options, value, onChange, size = "md", fluid, disabled }: Props<T>) {
  const name = useId();
  return (
    <fieldset className={`fieldset-plain segmented segmented-${size} ${fluid ? "segmented-fluid" : ""}`.trim()} disabled={disabled}>
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label key={o.value} className="segment">
          <input type="radio" className="sr-only" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
