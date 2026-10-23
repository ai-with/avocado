import type { ReactNode, Ref } from "react";
import { Button } from "../../../ui";
import "./demo.css";

type Props = { label: string; frameRef: Ref<HTMLDivElement>; onReplay: () => void; children: ReactNode; className?: string };

// 기능 데모 공통 틀: 히어로 목업과 같은 톤의 패널 + 오른쪽 위 "다시 보기"
export function DemoFrame({ label, frameRef, onReplay, children, className = "" }: Props) {
  return (
    <div ref={frameRef} className={`demo ${className}`} role="group" aria-label={label}>
      <div className="demo-bar">
        <span className="demo-label">{label}</span>
        <Button variant="ghost" size="sm" onClick={onReplay}>다시 보기</Button>
      </div>
      {children}
    </div>
  );
}
