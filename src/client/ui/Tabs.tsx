import type { KeyboardEvent } from "react";
import "./Tabs.css";

type Tab<T extends string> = { value: T; label: string };
type Props<T extends string> = { tabs: Tab<T>[]; value: T; onChange: (v: T) => void; label?: string };

const STEP: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };

// WAI-ARIA 탭 패턴: 선택된 탭만 Tab 키로 들어오고, 좌우 화살표로 옮긴다
export function Tabs<T extends string>({ tabs, value, onChange, label }: Props<T>) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = STEP[e.key];
    if (!step) return;
    e.preventDefault();
    const index = tabs.findIndex((t) => t.value === value);
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (!next) return;
    onChange(next.value);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" data-value={t.value} aria-selected={t.value === value} tabIndex={t.value === value ? 0 : -1} className="tab" onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
