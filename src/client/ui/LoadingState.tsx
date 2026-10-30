import "./LoadingState.css";

const DEFAULT_LINES = 3;

type Pattern = "lines" | "list" | "card";
type Props = { lines?: number; label?: string; pattern?: Pattern };

// 데이터를 받기 전 빈 화면 대신 보이는 자리 표시. 화면 낭독기에는 "불러오는 중"으로 읽힌다
// pattern: lines(제목 + 글줄, 기본), list(동그라미 + 두 줄 행을 lines 개), card(카드 면을 lines 개)
export function LoadingState({ lines = DEFAULT_LINES, label = "불러오는 중", pattern = "lines" }: Props) {
  const items = Array.from({ length: lines }, (_, i) => i);
  return (
    <div className={pattern === "lines" ? "loading" : `loading loading-pattern-${pattern}`} role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {pattern === "lines" && items.map((i) => <span key={i} className="loading-line" aria-hidden="true" />)}
      {pattern === "list" && items.map((i) => (
        <span key={i} className="loading-row" aria-hidden="true">
          <span className="loading-dot" />
          <span className="loading-row-lines"><span className="loading-bar" /><span className="loading-bar loading-bar-short" /></span>
        </span>
      ))}
      {pattern === "card" && items.map((i) => <span key={i} className="loading-card" aria-hidden="true" />)}
    </div>
  );
}
