import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, EmptyState, FilterBar, LoadingState, PageHeader, Table, Tabs, type BadgeTone, SelectMenu } from "../../ui";
import { api } from "../../lib/api";
import { fmtDateTime } from "../guides/types";
import { CONFLICT_LABEL, REVIEW_STATE_LABELS, type ReviewState } from "../../../shared/review";
import { RuleSuggestions } from "./sections/RuleSuggestions";
import type { ReviewRow } from "./types";
import { DRIVE_BLOCKED_LABEL } from "./labels";
import "./reviews.css";

const STATE_TONE: Record<ReviewState, BadgeTone> = {
  waiting: "neutral",
  processing: "info",
  needs_review: "warn",
  feedback_sent: "accent",
  approved: "success",
  after_approval: "warn",
  superseded: "neutral",
};
type Filter = "all" | ReviewState;
const FILTERS: { value: Filter; label: string }[] = [{ value: "all", label: "전체" }, ...(Object.keys(REVIEW_STATE_LABELS) as ReviewState[]).map((s) => ({ value: s, label: REVIEW_STATE_LABELS[s] }))];

// 승인 뒤 새 버전은 '검수 필요'와 같은 주의 색이라 점을 붙여 구분한다
export const StateBadge = ({ row }: { row: Pick<ReviewRow, "state" | "delayed"> & Partial<Pick<ReviewRow, "conflicts">> }) => (
  <span className="row row-tight row-wrap">
    <Badge tone={STATE_TONE[row.state]} dot={row.state === "after_approval"}>{REVIEW_STATE_LABELS[row.state]}</Badge>
    {row.delayed && <Badge tone="danger">처리 지연</Badge>}
    {!!row.conflicts && <Badge tone="warn">{CONFLICT_LABEL}</Badge>}
  </span>
);

// /reviews 검수함 (W06 진입)
export function ReviewsPage() {
  return (
    <>
      <PageHeader title="초안검수" description="올라온 영상을 처리 상태별로 모았어요. 위반 후보는 참고용이고 판단은 직접 해요." />
      <ReviewList />
    </>
  );
}

// 가이드 상세의 검수 탭에서도 쓴다
export function ReviewList({ guideId }: { guideId?: string }) {
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [guide, setGuide] = useState(guideId ?? "");
  const [influencer, setInfluencer] = useState("");
  const load = useCallback(async () => setRows((await api.get<{ rows: ReviewRow[] }>(`/reviews${guideId ? `?guideId=${guideId}` : ""}`)).rows), [guideId]);
  useEffect(() => void load(), [load]);

  const guides = useMemo(() => uniq(rows?.map((r) => r.guide) ?? []), [rows]);
  const people = useMemo(() => uniq(rows?.map((r) => ({ id: r.influencer.id, name: r.influencer.displayName })) ?? []), [rows]);
  if (!rows) return <LoadingState label="검수 목록을 불러오는 중" />;
  const shown = rows.filter((r) => (filter === "all" || r.state === filter) && (!guide || r.guide.id === guide) && (!influencer || r.influencer.id === influencer));
  const count = (s: Filter) => (s === "all" ? rows.length : rows.filter((r) => r.state === s).length);

  return (
    <div className="stack">
      <RuleSuggestions guideId={guideId} />
      <Tabs tabs={FILTERS.map((f) => ({ ...f, label: `${f.label} ${count(f.value)}` }))} value={filter} onChange={setFilter} />
      <FilterBar label="검수 목록 필터">
        {!guideId && (
          <SelectMenu aria-label="가이드" options={[{ value: "", label: "모든 가이드" }, ...guides.map((g) => ({ value: g.id, label: g.name }))]} value={guide} onChange={(v) => setGuide(v ?? "")} />
        )}
        <SelectMenu aria-label="인플루언서" options={[{ value: "", label: "모든 인플루언서" }, ...people.map((p) => ({ value: p.id, label: p.name }))]} value={influencer} onChange={(v) => setInfluencer(v ?? "")} />
      </FilterBar>
      {shown.length === 0 ? (
        <EmptyState title="검수할 영상이 없어요" description="인플루언서가 업로드 링크로 영상을 올리면 처리 후 여기에 쌓여요. 필터를 걸었다면 조건을 바꿔 보세요." />
      ) : (
        <ReviewTable rows={shown} showGuide={!guideId} />
      )}
    </div>
  );
}

function ReviewTable({ rows, showGuide }: { rows: ReviewRow[]; showGuide: boolean }) {
  return (
    <Table>
      <thead>
        <tr><th>인플루언서</th>{showGuide && <th>가이드</th>}<th>버전</th><th>상태</th><th className="num">위반 후보·확인 필요</th><th>올린 시각</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td><Link to={`/dashboard/reviews/${r.id}`}>{r.influencer.displayName}</Link>{r.influencer.igHandle && <span className="text-caption"> @{r.influencer.igHandle}</span>}</td>
            {showGuide && <td>{r.guide.name}</td>}
            <td>v{r.version}{r.driveUrl && <span className="text-caption"> 드라이브 링크</span>}{r.driveAccess === "blocked" && <> <Badge tone="warn">{DRIVE_BLOCKED_LABEL}</Badge></>}</td>
            <td><StateBadge row={r} /></td>
            <td className="num">{r.state === "waiting" || r.state === "processing" ? <span className="text-caption">처리 후 표시</span> : `${r.candidates}건`}</td>
            <td className="nowrap">{r.uploadedAt ? fmtDateTime(r.uploadedAt) : ""}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function uniq<T extends { id: string }>(list: T[]): T[] {
  return [...new Map(list.map((x) => [x.id, x])).values()];
}
