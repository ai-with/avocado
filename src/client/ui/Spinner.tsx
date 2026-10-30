import "./Feedback.css";

type Props = { size?: "sm" | "md" | "lg"; label?: string };

// 짧은 기다림 표시. label 이 있으면 화면 낭독기에 "불러오는 중"처럼 읽히고, 없으면 장식(버튼 안처럼 옆에 이미 상태가 있을 때)
// 화면 전체·목록 자리 표시는 LoadingState, 버튼 진행은 Button loading
export function Spinner({ size = "md", label }: Props) {
  if (!label) return <span className={`spinner spinner-${size}`} aria-hidden="true" />;
  return (
    <span className="spinner-wrap" role="status">
      <span className={`spinner spinner-${size}`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
