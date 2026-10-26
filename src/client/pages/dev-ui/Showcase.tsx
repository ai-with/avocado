import type { ReactNode } from "react";

export function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="dev-group">
      <h3>{title}</h3>
      {note && <p className="text-caption">{note}</p>}
      <div className="dev-specimens">{children}</div>
    </section>
  );
}

// 상태 하나를 이름표와 함께 보여 주는 칸
export function Specimen({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`dev-specimen ${wide ? "dev-specimen-wide" : ""}`}>
      <span className="text-caption">{label}</span>
      {children}
    </div>
  );
}
