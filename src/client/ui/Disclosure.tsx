import type { ReactNode } from "react";
import { Icon } from "./icons";
import "./Disclosure.css";

type Props = { title: ReactNode; count?: number; description?: ReactNode; defaultOpen?: boolean; children: ReactNode };

// 접었다 펴는 묶음(지난 버전, 적용된 규칙 목록, 자주 묻는 질문). 네이티브 details/summary 라 Enter·Space 로 열고 닫는다
// count 는 접혀 있어도 안에 몇 개가 있는지 보여 준다. 처음부터 꼭 봐야 하는 내용은 접지 않는다
export function Disclosure({ title, count, description, defaultOpen, children }: Props) {
  return (
    <details className="disclosure" open={defaultOpen}>
      <summary className="disclosure-summary">
        <Icon name="chevron-right" size={16} />
        <span className="disclosure-title">{title}</span>
        {count !== undefined && <span className="disclosure-count num">{count.toLocaleString("ko-KR")}</span>}
        {description && <span className="disclosure-desc">{description}</span>}
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
