import type { HTMLAttributes, ReactNode } from "react";
import "./Card.css";

export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...rest} />;
}

type SectionCardProps = { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; id?: string };

// 제목(+설명, 오른쪽 동작 버튼)과 본문으로 이뤄진 카드. 화면의 한 덩어리 기능을 묶는다
export function SectionCard({ title, description, actions, children, className = "", id }: SectionCardProps) {
  return (
    <section className={`card section-card ${className}`} id={id}>
      <div className="section-card-head">
        <div className="section-card-title">
          <h4>{title}</h4>
          {description && <p className="text-secondary">{description}</p>}
        </div>
        {actions && <div className="row row-wrap">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
