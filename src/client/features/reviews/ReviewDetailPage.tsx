import { useState } from "react";
import { useParams } from "react-router-dom";
import { LoadingState, Tabs } from "../../ui";
import { useReviewDetail } from "./useReviewDetail";
import { ReviewHeader, ReviewStatusRow } from "./sections/ReviewHeader";
import { PlayerPanel } from "./sections/PlayerPanel";
import { CandidatesTab } from "./sections/CandidatesTab";
import { TranscriptTab } from "./sections/TranscriptTab";
import { FeedbackTab } from "./sections/FeedbackTab";
import { VersionsTab } from "./sections/VersionsTab";
import "./reviews.css";

type Tab = "candidates" | "transcript" | "feedback" | "versions";

// /reviews/:submissionId 검수 화면 (W06, F-60~F-62)
export function ReviewDetailPage() {
  const { submissionId = "" } = useParams();
  const r = useReviewDetail(submissionId);
  const [tab, setTab] = useState<Tab>("candidates");
  const { d, base, frame, seek, act, processing } = r;
  if (!d) return <LoadingState pattern="detail" label="검수 화면을 불러오는 중" />;
  const locked = d.locked;
  const canEdit = d.canEdit && !locked;
  const flagged = d.candidates.filter((c) => c.result === "candidate").length;
  const tabs: { value: Tab; label: string }[] = [
    { value: "candidates", label: `위반 후보 ${flagged}` },
    { value: "transcript", label: "전사" },
    { value: "feedback", label: `피드백 ${d.drafts.length}` },
    { value: "versions", label: "버전" },
  ];
  return (
    <>
      <ReviewHeader d={d} onApprove={r.approve} onKeep={r.keepApproval} />
      <div className="stack">
        <ReviewStatusRow d={d} />
        <div className="review-grid">
          <PlayerPanel d={d} video={r.video} selected={frame} processing={processing} onPick={r.pickFrame} />
          <div className="stack review-right">
            <Tabs tabs={tabs} value={tab} onChange={setTab} />
            {tab === "candidates" && <CandidatesTab d={d} base={base} canEdit={canEdit} processing={processing} selected={frame} onSeek={seek} onAct={act} />}
            {tab === "transcript" && <TranscriptTab d={d} base={base} canEdit={d.canEdit} onSeek={seek} onAct={act} />}
            {tab === "feedback" && <FeedbackTab d={d} base={base} canEdit={canEdit} locked={locked} selected={frame} pickCurrent={r.pickCurrent} onSeek={seek} onAct={act} reload={r.load} />}
            {tab === "versions" && <VersionsTab d={d} />}
          </div>
        </div>
      </div>
    </>
  );
}
