import { Skeleton } from "./Skeleton";
import "./LoadingState.css";

const DEFAULT_LINES = 3;

type Pattern = "lines" | "list" | "card" | "table" | "detail";
type Props = { lines?: number; label?: string; pattern?: Pattern };

// 패턴별 조각. TDS Skeleton 모듈(title·subtitle·list·listWithIcon·card)을 그대로 조합한다
function Rows({ pattern, items }: { pattern: Pattern; items: number[] }) {
  if (pattern === "list") return <>{items.map((i) => <span key={i} className="loading-row"><Skeleton shape="circle" /><span className="skeleton skeleton-bar" /></span>)}</>;
  if (pattern === "card") return <>{items.map((i) => <span key={i} className="skeleton skeleton-card" />)}</>;
  if (pattern === "table") return <>{items.map((i) => <span key={i} className="loading-table-row"><Skeleton width="28%" /><Skeleton width="18%" /><Skeleton width="12%" /></span>)}</>;
  if (pattern === "detail") return <><Skeleton shape="title" /><Skeleton /><span className="loading-spacer" />{items.map((i) => <Skeleton key={i} shape="rect" />)}</>;
  return <><Skeleton shape="title" />{items.slice(1).map((i) => <Skeleton key={i} className={i % 3 === 2 ? "skeleton-short" : ""} />)}</>;
}

// 데이터를 받기 전 빈 화면 대신 콘텐츠 모양을 미리 보여 준다. 화면 낭독기에는 label 로 읽힌다
// pattern: lines(제목 + 글줄, 기본), list(아이콘 + 줄, 목록), card(큰 카드 면), table(표 줄), detail(제목·부제 + 큰 줄, 상세 화면). lines 는 줄·행·카드 개수
export function LoadingState({ lines = DEFAULT_LINES, label = "불러오는 중", pattern = "lines" }: Props) {
  const items = Array.from({ length: lines }, (_, i) => i);
  return (
    <div className={`loading loading-pattern-${pattern}`} role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <span className="loading-body" aria-hidden="true"><Rows pattern={pattern} items={items} /></span>
    </div>
  );
}
