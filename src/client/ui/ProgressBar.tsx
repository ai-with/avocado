import "./Feedback.css";

type Tone = "accent" | "success" | "danger";
type Props = { value: number; label: string; showValue?: boolean; size?: "sm" | "md"; tone?: Tone };

const toPercent = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100);

// 진행률 막대. value 는 0~1(벗어나면 끝값으로 자름). label 은 무엇의 진행인지(화면 낭독기와 showValue 줄에 쓰임)
export function ProgressBar({ value, label, showValue, size = "md", tone = "accent" }: Props) {
  const percent = toPercent(value);
  return (
    <div className="progress">
      {showValue && (
        <div className="progress-head">
          <span>{label}</span>
          <span className="num">{percent}%</span>
        </div>
      )}
      <div className={`progress-track progress-${size}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className={`progress-fill progress-${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
