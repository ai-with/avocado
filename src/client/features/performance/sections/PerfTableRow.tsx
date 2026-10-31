import { Badge } from "../../../ui";
import { fmtDateTime } from "../../guides/types";
import { FORMAT_LABELS, MAIN_METRICS, REASON_LABELS, SNAPSHOT_OFFSETS, type SnapshotPath } from "../../../../shared/performance";
import type { PerfRow, Snap } from "../perfTypes";
import { ContentThumbnail } from "./ContentThumbnail";

const PATH_LABELS: Record<SnapshotPath, string> = { connected: "연결", discovery: "미연결" };

function Cell({ snap, metric }: { snap: Snap | undefined; metric: (typeof MAIN_METRICS)[number] }) {
  if (!snap) return <td className="num text-caption">-</td>;
  if (snap.status === "scheduled") return <td className="num text-caption" title={`${fmtDateTime(snap.scheduledAt)} 예정`}>예정</td>;
  const v = snap[metric];
  if (v !== null) return <td className="num">{v.toLocaleString("ko-KR")}</td>;
  const reason = snap.missing[metric] ?? snap.missing._;
  const label = reason ? REASON_LABELS[reason] : "값 없음";
  return (
    <td className="num">
      <span className="perf-missing" title={label} aria-label={label}>
        <span aria-hidden="true">ⓘ</span> {label}
      </span>
    </td>
  );
}

function PostedAtCell({ r, onEdit }: { r: PerfRow; onEdit?: () => void }) {
  return (
    <td className="nowrap">
      {r.postedAt ? fmtDateTime(r.postedAt) : <span className="text-caption" title="게시 시각을 읽지 못해 등록 시각 기준으로 예약했어요">{fmtDateTime(r.registeredAt)} (등록 기준)</span>}
      {r.postedAtSource === "manual" && <Badge>수동</Badge>}
      {onEdit && <div><button type="button" className="link-button text-caption" onClick={onEdit}>게시 시각 입력</button></div>}
    </td>
  );
}

function PathCell({ r }: { r: PerfRow }) {
  const paths = new Set(SNAPSHOT_OFFSETS.map((o) => r.snapshots[o]?.path).filter((p): p is SnapshotPath => Boolean(p)));
  return (
    <td>
      {paths.size === 0 ? <span className="text-caption">{r.connected ? "연결" : "미연결"}</span> : [...paths].map((p) => <Badge key={p} tone={p === "connected" ? "success" : "neutral"}>{PATH_LABELS[p]}</Badge>)}
      {paths.size > 1 && <div className="text-caption">경로 바뀜</div>}
      {SNAPSHOT_OFFSETS.some((o) => r.snapshots[o]?.delayed) && <div className="text-caption">지연 수집 있음</div>}
      {r.collectionStoppedReason && <div className="perf-collection-note"><Badge tone="warn">수집 중지</Badge><div className="text-caption">{r.collectionStoppedReason === "campaign_ended" ? "캠페인 종료 후 7일이 지났어요." : r.collectionStoppedReason === "campaign_end_unknown" ? "캠페인 종료 시각을 확인해 주세요." : "연결된 캠페인을 확인해 주세요."}</div></div>}
      {!r.collectionStoppedReason && r.collectionEndsAt !== null && <div className="text-caption">{fmtDateTime(r.collectionEndsAt)} 수집 종료</div>}
    </td>
  );
}

// 게시물 한 줄. onEdit 이 있으면(편집 권한) 게시 시각 입력 버튼을 보인다
export function PerfTableRow({ r, showGuide, onEdit, onRetry, retrying }: { r: PerfRow; showGuide: boolean; onEdit?: () => void; onRetry?: () => void; retrying?: boolean }) {
  return (
    <tr>
      <td>
        <div className="row">
          <ContentThumbnail src={r.thumbnailUrl} fetchedAt={r.thumbnailFetchedAt} />
          <div><div>{r.influencerName}</div><a className="text-caption" href={r.url} target="_blank" rel="noreferrer">게시물 보기</a>{showGuide && <div className="text-caption">{r.guideName}</div>}
            {onRetry && <div><button type="button" className="link-button text-caption" onClick={onRetry} disabled={retrying || Boolean(r.collectionStoppedReason)}>{retrying ? "수집 예약 중" : "다시 수집"}</button></div>}
          </div>
        </div>
      </td>
      <td>{FORMAT_LABELS[r.format]}</td>
      <PostedAtCell r={r} onEdit={onEdit} />
      {SNAPSHOT_OFFSETS.flatMap((o) => MAIN_METRICS.map((m) => <Cell key={`${o}${m}`} snap={r.snapshots[o]} metric={m} />))}
      <td className="num">{r.clicks}</td>
      <td className="num">{r.leads}</td>
      <PathCell r={r} />
    </tr>
  );
}
