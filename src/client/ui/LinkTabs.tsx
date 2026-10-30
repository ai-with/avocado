import { Link } from "react-router-dom";
import { Badge } from "./Badge";
import "./Tabs.css";

export type LinkTab = { key: string; label: string; to: string | null; count?: number };
type Props = { tabs: LinkTab[]; current: string; label: string };

// 화면 사이를 오가는 탭 줄. 같은 화면 안 보기 전환은 Tabs, 주소가 다른 화면끼리는 이것.
// to 가 null 이면 잠긴 탭(누를 수 없음). count 가 0 보다 크면 옆에 배지
export function LinkTabs({ tabs, current, label }: Props) {
  return (
    <nav className="tabs link-tabs" aria-label={label}>
      {tabs.map((t) => {
        const body = <>{t.label}{!!t.count && <Badge tone="accent">{t.count}</Badge>}</>;
        if (!t.to) return <span key={t.key} className="tab is-locked" aria-disabled="true">{body}</span>;
        return <Link key={t.key} to={t.to} className="tab" aria-current={t.key === current ? "page" : undefined}>{body}</Link>;
      })}
    </nav>
  );
}
