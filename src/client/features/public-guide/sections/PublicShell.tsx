import type { ReactNode } from "react";
import "../public.css";

type ShellProps = { brand?: string; langLabel: string; onToggleLang: () => void; children: ReactNode; className?: string };

// 공개 화면 공통 틀: 브랜드 이름과 언어 전환이 있는 머리글 + 가운데 본문
export function PublicShell({ brand, langLabel, onToggleLang, children, className = "" }: ShellProps) {
  return (
    <div className="pub">
      <header className="pub-head">
        <span className="pub-brand">{brand}</span>
        <button type="button" className="pub-lang" onClick={onToggleLang}>{langLabel}</button>
      </header>
      <main className={`pub-main ${className}`}>{children}</main>
    </div>
  );
}

export function PublicSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pub-section">
      <h2 className="pub-h">{title}</h2>
      {children}
    </section>
  );
}

// 문자열 목록. 같은 문구가 키로 쓰이므로 목록 안에서 중복이 없어야 한다
export function TextList({ items, className = "" }: { items: string[]; className?: string }) {
  return <ul className={`pub-list ${className}`}>{items.map((x) => <li key={x}>{x}</li>)}</ul>;
}
