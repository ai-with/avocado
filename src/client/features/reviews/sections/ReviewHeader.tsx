import { Badge, Button, Card, PageHeader, ButtonAnchor } from "../../../ui";
import { fmtDateTime } from "../../guides/types";
import { JOB_STAGES, JOB_STATUS_LABELS, STAGE_LABELS } from "../../../../shared/review";
import { JOB_TONE } from "../labels";
import type { ReviewDetail } from "../types";

export function ReviewHeader({ d, onApprove }: { d: ReviewDetail; onApprove: () => void }) {
  return (
    <PageHeader
      title={`${d.influencer.displayName} · v${d.submission.version}`}
      description={d.guide.name}
      back={{ to: "/reviews", label: "검수함" }}
      actions={
        <>
          {d.submission.videoUrl && <ButtonAnchor href={`${d.submission.videoUrl}?download=1`}>원본 내려받기</ButtonAnchor>}
          {d.cleanUrl && <ButtonAnchor href={`${d.cleanUrl}?download=1`}>클린본 내려받기</ButtonAnchor>}
          {d.approval ? <Badge tone="success">최종 승인됨 {fmtDateTime(d.approval.approvedAt)}</Badge> : d.canApprove && <Button onClick={onApprove}>최종 승인</Button>}
        </>
      }
    />
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
        <Card>드라이브 링크로 제출된 영상이에요. 자동 처리하지 않으니 직접 확인해 주세요. <a href={d.submission.driveUrl} target="_blank" rel="noreferrer">링크 열기</a></Card>
      )}
    </>
  );
}
