import type { Emit, Uninstall } from "../types";
import { cssPath, isExcluded } from "./dom";

const NON_INPUT_TYPES = ["hidden", "submit", "button", "reset", "image"];

/** 입력 필드 개수만 센다. 입력값은 읽지 않는다 (docs/14 3-1) */
export function countFields(form: HTMLFormElement): number {
  return [...form.elements].filter((element) => {
    if (element instanceof HTMLInputElement) return !NON_INPUT_TYPES.includes(element.type);
    return element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement;
  }).length;
}

export function installFormCapture(emit: Emit): Uninstall {
  const onSubmit = (event: Event): void => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || isExcluded(form)) return;
    emit({ t: "form_submit", sel: cssPath(form), fields: countFields(form) });
  };
  document.addEventListener("submit", onSubmit, { capture: true, passive: true });
  return () => document.removeEventListener("submit", onSubmit, { capture: true });
}
