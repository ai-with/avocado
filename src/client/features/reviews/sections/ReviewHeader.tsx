import { Badge, Button, Card, PageHeader, ButtonAnchor } from "../../../ui";
import { fmtDateTime } from "../../guides/types";
import { JOB_STAGES, JOB_STATUS_LABELS, STAGE_LABELS } from "../../../../shared/review";
import { DRIVE_BLOCKED_LABEL, JOB_TONE } from "../labels";
import type { ReviewDetail } from "../types";

type Approval = { onApprove: () => void; onKeep: () => void };

export function ReviewHeader({ d, onApprove, onKeep }: { d: ReviewDetail } & Approval) {
  return (
    <PageHeader
      title={`${d.influencer.displayName} · v${d.submission.version}`}
      description={d.guide.name}
      back={{ to: "/dashboard/reviews", label: "초안검수" }}
      actions={
        <>
          {d.submission.videoUrl && <ButtonAnchor href={`${d.submission.videoUrl}?download=1`}>원본 내려받기</ButtonAnchor>}
          {d.cleanUrl && <ButtonAnchor href={`${d.cleanUrl}?download=1`}>클린본 내려받기</ButtonAnchor>}
          <ApprovalActions d={d} onApprove={onApprove} onKeep={onKeep} />
        </>
      }
    />
  );
}

// 승인 상태와 버튼. 승인 뒤 새 버전이면 이 버전으로 승인을 옮기거나 기존 승인을 유지한다 (340)
function ApprovalActions({ d, onApprove, onKeep }: { d: ReviewDetail } & Approval) {
  if (!d.approval) return d.canApprove ? <Button onClick={onApprove}>최종 승인</Button> : null;
  if (d.approval.submissionId === d.submission.id) return <Badge tone="success">최종 승인됨 {fmtDateTime(d.approval.approvedAt)}</Badge>;
  if (d.superseded) return <Badge>기존 승인 유지 · v{d.approvedVersion} 승인</Badge>;
  if (!d.afterApproval) return <Badge tone="success">v{d.approvedVersion} 최종 승인됨</Badge>;
  return (
    <>
      <Badge tone="warn" dot>승인 뒤 새 버전 · v{d.approvedVersion} 승인</Badge>
      {d.canApprove && <Button variant="secondary" onClick={onKeep}>기존 승인 유지</Button>}
      {d.canApprove && <Button onClick={onApprove}>이 버전으로 승인</Button>}
    </>
  );
}

// 처리 단계별 상태 + 드라이브 제출 안내
export function ReviewStatusRow({ d }: { d: ReviewDetail }) {
  return (
    <>
      <div className="row row-wrap row-tight">
        {JOB_STAGES.map((s) => {
          const j = d.jobs.find((x) => x.stage === s);
          return <Badge key={s} tone={j ? JOB_TONE[j.status] : "neutral"}>{STAGE_LABELS[s]} {j ? JOB_STATUS_LABELS[j.status] : "대기"}</Badge>;
        })}
        {d.submission.delayed && <Badge tone="danger">처리 지연</Badge>}
        {d.content && <a href={d.content.url} target="_blank" rel="noreferrer" className="text-caption">게시물 보기</a>}
      </div>
      {d.submission.driveUrl && (
        <Card>
          {d.submission.driveAccess === "blocked" && <><Badge tone="warn">{DRIVE_BLOCKED_LABEL}</Badge> 제출할 때 로그인 없이 열리지 않았어요. 공유 설정을 바꿔 달라고 요청해 주세요.<br /></>}
          드라이브 링크로 제출된 영상이에요. 자동 처리하지 않으니 직접 확인해 주세요. <a href={d.submission.driveUrl} target="_blank" rel="noreferrer">링크 열기</a>
        </Card>
      )}
    </>
  );
}
