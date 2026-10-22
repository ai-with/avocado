import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import "./EmptyState.css";

type Props = { title: string; description?: string; action?: ReactNode; icon?: IconName; compact?: boolean };

// 숫자 0 대신 "채우는 방법"을 알려 주는 빈 화면
export function EmptyState({ title, description, action, icon, compact }: Props) {
  return (
    <div className={`empty ${compact ? "empty-compact" : ""}`}>
      {icon && <span className="empty-icon"><Icon name={icon} size={20} /></span>}
      <h4>{title}</h4>
      {description && <p className="text-secondary">{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
