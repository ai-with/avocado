import type { ReactNode } from "react";
import { IconButton } from "./Button";
import { useDialog } from "./useDialog";
import "./Drawer.css";

type Props = { title: string; description?: ReactNode; onClose: () => void; children: ReactNode; side?: "right" | "bottom" };

// 오른쪽에서 열리는 상세 패널. 열려 있는 동안만 렌더한다
// side="bottom": 아래에서 올라오는 시트(공개 화면 휴대폰의 선택 목록·짧은 확인). 바깥을 누르면 닫히는 것이 기본
export function Drawer({ title, description, onClose, children, side = "right" }: Props) {
  const ref = useDialog<HTMLElement>(true, onClose);
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={ref} className={side === "bottom" ? "drawer drawer-bottom" : "drawer"} role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-head">
          <div className="grow">
            <h4>{title}</h4>
            {description && <p className="text-secondary">{description}</p>}
          </div>
          <IconButton icon="x" label="닫기" size="sm" onClick={onClose} />
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
