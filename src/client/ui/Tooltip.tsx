import { cloneElement, useEffect, useId, useState, type ReactElement } from "react";
import "./Feedback.css";

type Trigger = ReactElement<{ "aria-describedby"?: string }>;
type Props = { content: string; children: Trigger; placement?: "top" | "bottom" };

// 아이콘 버튼·지표 이름 옆 짧은 보조 설명. 마우스를 올리거나 키보드로 포커스하면 열리고, 떠나거나 Esc 로 닫힌다
// 설명은 aria-describedby 로 트리거에 이어져 화면 낭독기가 함께 읽는다. 누르는 동작·긴 글은 넣지 않는다
export function Tooltip({ content, children, placement = "top" }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const describedBy = [children.props["aria-describedby"], id].filter(Boolean).join(" ");
  return (
    <span className="tooltip-anchor" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {cloneElement(children, { "aria-describedby": describedBy })}
      <span id={id} role="tooltip" className={`tooltip tooltip-${placement}`} hidden={!open}>{content}</span>
    </span>
  );
}
