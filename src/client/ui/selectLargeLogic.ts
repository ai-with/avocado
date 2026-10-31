import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import type { SelectOption } from "./selectMenuLogic";

type OptionProps = { value?: string | number; disabled?: boolean; children?: ReactNode };
type GroupProps = { label?: string; disabled?: boolean; children?: ReactNode };

const textOf = (node: ReactNode): string => Children.toArray(node).filter((c) => typeof c === "string" || typeof c === "number").join("");

function fromOption(el: ReactElement<OptionProps>, group?: string, groupDisabled?: boolean): SelectOption {
  const label = textOf(el.props.children);
  return { value: String(el.props.value ?? label), label, disabled: el.props.disabled || groupDisabled || undefined, group };
}

// 네이티브 <select> 자식(<option>, <optgroup label>)을 SelectMenu 선택지로 바꾼다. 그 밖의 자식은 무시한다
export function optionsFromChildren(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue;
    if (child.type === "optgroup") {
      const g = child as ReactElement<GroupProps>;
      for (const o of Children.toArray(g.props.children)) {
        if (isValidElement(o) && o.type === "option") out.push(fromOption(o as ReactElement<OptionProps>, g.props.label, g.props.disabled));
      }
    } else if (child.type === "option") {
      out.push(fromOption(child as ReactElement<OptionProps>));
    }
  }
  return out;
}

// 네이티브 select 처럼 값이 선택지에 없으면 첫 활성 선택지를 보여 준다(선택지가 없으면 null)
export function shownValue(options: SelectOption[], current: string): string | null {
  if (options.some((o) => o.value === current)) return current;
  return options.find((o) => !o.disabled)?.value ?? null;
}
