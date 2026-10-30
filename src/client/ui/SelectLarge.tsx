import type { ChangeEvent, ReactNode, SelectHTMLAttributes } from "react";
import { useState } from "react";
import type { FieldProps } from "./Field";
import { optionsFromChildren } from "./selectLargeLogic";
import { SelectMenu } from "./SelectMenu";

export type SelectLargeProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size" | "children" | "value" | "defaultValue"> &
  FieldProps & { value?: string | number; defaultValue?: string | number; children?: ReactNode };

// 호출부는 e.target.value 만 읽으므로 같은 모양의 값만 담아 넘긴다. 실제 select 요소는 없다
function changeEvent(value: string, name?: string): ChangeEvent<HTMLSelectElement> {
  const target = { value, name: name ?? "" };
  return { target, currentTarget: target } as unknown as ChangeEvent<HTMLSelectElement>;
}

// Select size="lg" 의 본체. 네이티브 select 와 같은 props 를 받아 SelectMenu 의 직접 그린 목록으로 연다
export function SelectLarge({ label, hint, error, id, name, value, defaultValue, onChange, disabled, required, children }: SelectLargeProps) {
  const [inner, setInner] = useState(defaultValue === undefined ? "" : String(defaultValue));
  const current = value === undefined ? inner : String(value);
  const options = optionsFromChildren(children);
  const known = options.some((o) => o.value === current);
  const choose = (next: string | null) => {
    const v = next ?? "";
    if (value === undefined) setInner(v);
    onChange?.(changeEvent(v, name));
  };
  return (
    <>
      <SelectMenu
        size="lg" label={label} hint={hint} error={error} id={id} disabled={disabled} required={required} searchable={false}
        options={options} value={known ? current : null} onChange={choose}
      />
      {name && !disabled && <input type="hidden" name={name} value={current} />}
    </>
  );
}
