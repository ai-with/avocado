import type { ReactNode } from "react";
import "./FilterBar.css";

type Props = { children: ReactNode; actions?: ReactNode; label?: string };

// 목록 위 검색·필터 줄. 칸은 내용 너비만큼만 차지하고, 좁은 화면에서는 두 칸씩 접힌다
export function FilterBar({ children, actions, label = "목록 필터" }: Props) {
  return (
    <div className="filter-bar" role="group" aria-label={label}>
      <div className="filter-bar-fields">{children}</div>
      {actions && <div className="filter-bar-actions">{actions}</div>}
    </div>
  );
}
