import type { ReactNode } from "react";
import { Icon } from "./icons";
import "./Feedback.css";

type Props = {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  withArrow?: boolean;
  disabled?: boolean;
  padding?: "sm" | "md" | "lg";
};

// 왼쪽(아바타·아이콘), 가운데(제목·설명), 오른쪽(값·배지·스위치) 세 칸 행. 설정·연결 계정·알림 목록
// onClick 이 있으면 행 전체가 버튼이 된다. 이때 trailing 에 버튼·스위치처럼 누르는 것을 넣지 않는다(버튼 안 버튼 금지)
export function ListRow({ title, description, leading, trailing, onClick, withArrow, disabled, padding = "md" }: Props) {
  const body = (
    <>
      {leading && <span className="list-row-leading">{leading}</span>}
      <span className="list-row-main">
        <span className="list-row-title">{title}</span>
        {description && <span className="list-row-desc">{description}</span>}
      </span>
      {trailing && <span className="list-row-trailing">{trailing}</span>}
      {withArrow && <Icon name="chevron-right" size={16} />}
    </>
  );
  const cls = `list-row list-row-${padding} ${disabled ? "is-disabled" : ""}`.trim();
  if (!onClick) return <div className={cls}>{body}</div>;
  return <button type="button" className={`${cls} list-row-button`} onClick={onClick} disabled={disabled}>{body}</button>;
}
