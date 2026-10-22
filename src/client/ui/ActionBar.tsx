import type { ReactNode } from "react";
import "./ActionBar.css";

// 긴 편집 화면 아래에 붙어 따라오는 저장·취소 줄. 스크롤 위치와 상관없이 주요 동작이 보인다
export function ActionBar({ children, status }: { children: ReactNode; status?: ReactNode }) {
  return (
    <div className="action-bar">
      <div className="action-bar-status text-caption">{status}</div>
      <div className="row row-wrap row-end">{children}</div>
    </div>
  );
}
