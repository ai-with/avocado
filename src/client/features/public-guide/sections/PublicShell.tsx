import type { ReactNode } from "react";
import { FloatingActionBarSlot } from "../../../ui";
import "../public.css";

type ShellProps = { brand?: string; langLabel: string; onToggleLang: () => void; children: ReactNode; className?: string; centerBrand?: boolean; tabs?: ReactNode };

// 공개 화면 공통 틀: 브랜드 이름과 언어 전환이 있는 머리글 + 가운데 본문.
// centerBrand 면 왼쪽에 보이지 않는 같은 폭 버튼을 두어 브랜드 이름이 화면 정가운데에 오게 한다.
// tabs 는 머리글 아래에 같이 붙어 스크롤해도 따라온다
export function PublicShell({ brand, langLabel, onToggleLang, children, className = "", centerBrand = false, tabs }: ShellProps) {
  return (
    <div className="pub">
      <div className="pub-top">
        <header className={centerBrand ? "pub-head is-centered" : "pub-head"}>
          {centerBrand && <span className="pub-lang pub-lang-spacer" aria-hidden="true">{langLabel}</span>}
          <span className="pub-brand">{brand}</span>
          <button type="button" className="pub-lang" onClick={onToggleLang}>{langLabel}</button>
        </header>
        {tabs}
      </div>
      <main className={`pub-main ${className}`}>{children}
        <FloatingActionBarSlot />
      </main>
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
