import "./LoadingState.css";

const DEFAULT_LINES = 3;

// 데이터를 받기 전 빈 화면 대신 보이는 자리 표시. 화면 낭독기에는 "불러오는 중"으로 읽힌다
export function LoadingState({ lines = DEFAULT_LINES, label = "불러오는 중" }: { lines?: number; label?: string }) {
  return (
    <div className="loading" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => <span key={i} className="loading-line" aria-hidden="true" />)}
    </div>
  );
}
