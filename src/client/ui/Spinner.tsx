import "./Feedback.css";

type Size = "sm" | "md" | "lg" | "xl";
type Props = { size?: Size; label?: string };

// TDS Loader 그림: 지름 66 기준 원(반지름 30, 선 6, 둥근 끝)의 호가 늘었다 줄며 돈다
function SpinnerArc({ size }: { size: Size }) {
  return (
    <svg className={`spinner spinner-${size}`} viewBox="0 0 66 66" aria-hidden="true">
      <circle className="spinner-arc" cx="33" cy="33" r="30" />
    </svg>
  );
}

// 짧은 기다림 표시. label 이 있으면 화면 낭독기에 "불러오는 중"처럼 읽히고, 없으면 장식(옆에 이미 상태 글이 있을 때)
// 영역 전체 자리 표시는 LoadingState(스켈레톤), 화면 전체 기다림은 Loader, 버튼 진행은 Button loading
export function Spinner({ size = "md", label }: Props) {
  if (!label) return <SpinnerArc size={size} />;
  return (
    <span className="spinner-wrap" role="status">
      <SpinnerArc size={size} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

type LoaderProps = { label?: string; size?: Exclude<Size, "sm">; fill?: boolean };

// TDS Loader + label: 가운데 스피너와 그 아래 문구(15px). 0.7초 뒤에 나타나 짧은 기다림에는 깜빡이지 않는다
// fill: 화면·영역 가운데에 놓는다(라우트 지연 로딩, 화면 전체 확인 중)
export function Loader({ label = "불러오는 중이에요", size = "lg", fill = false }: LoaderProps) {
  return (
    <div className={fill ? "loader loader-fill" : "loader"} role="status" aria-live="polite">
      <SpinnerArc size={size} />
      <span className="loader-label">{label}</span>
    </div>
  );
}
