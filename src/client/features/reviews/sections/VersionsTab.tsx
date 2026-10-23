import { Link } from "react-router-dom";
import type { ReviewDetail } from "../types";
import { RoundSection } from "./FeedbackRow";

const noSeek = () => undefined;

export function VersionsTab({ d }: { d: ReviewDetail }) {
  const prev = d.rounds.filter((r) => r.submissionId !== d.submission.id);
  return (
    <div className="stack">
      <div className="row row-wrap">
        {d.versions.map((v) => (
          <Link key={v.id} to={`/dashboard/reviews/${v.id}`} className={`version-pill${v.id === d.submission.id ? " is-active" : ""}`} aria-current={v.id === d.submission.id ? "page" : undefined}>
            v{v.version}{d.approval?.submissionId === v.id ? " 승인" : ""}
          </Link>
        ))}
      </div>
      <p className="text-caption">피드백 링크: <a href={d.feedbackUrl} target="_blank" rel="noreferrer">{d.feedbackUrl}</a></p>
      {prev.length === 0 ? (
        <p className="text-caption">이전 버전에 보낸 피드백이 없어요.</p>
      ) : (
        prev.map((r) => (
          <RoundSection key={r.id} title={`v${r.version ?? ""} · ${r.n}회차 피드백 (${r.items.filter((i) => i.influencerDone).length}/${r.items.length} 반영함)`} items={r.items} onSeek={noSeek} />
        ))
      )}
    </div>
  );
}
