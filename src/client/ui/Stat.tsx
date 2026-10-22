import type { ReactNode } from "react";
import "./Stat.css";

// 숫자 하나와 이름표. 여러 개는 StatGrid 로 묶는다
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}
