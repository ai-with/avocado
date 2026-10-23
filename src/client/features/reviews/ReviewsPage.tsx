import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, EmptyState, FilterBar, LoadingState, PageHeader, Select, Table, Tabs, type BadgeTone } from "../../ui";
import { api } from "../../lib/api";
import { fmtDateTime } from "../guides/types";
import { REVIEW_STATE_LABELS, type ReviewState } from "../../../shared/review";
import type { ReviewRow } from "./types";
import "./reviews.css";

const STATE_TONE: Record<ReviewState, BadgeTone> = { waiting: "neutral", processing: "info", needs_review: "warn", feedback_sent: "accent", approved: "success" };
type Filter = "all" | ReviewState;
const FILTERS: { value: Filter; label: string }[] = [{ value: "all", label: "전체" }, ...(Object.keys(REVIEW_STATE_LABELS) as ReviewState[]).map((s) => ({ value: s, label: REVIEW_STATE_LABELS[s] }))];

export const StateBadge = ({ row }: { row: Pick<ReviewRow, "state" | "delayed"> }) => (
  <span className="row row-tight">
    <Badge tone={STATE_TONE[row.state]}>{REVIEW_STATE_LABELS[row.state]}</Badge>
    {row.delayed && <Badge tone="danger">처리 지연</Badge>}
  </span>
);

// /reviews 검수함 (W06 진입)
export function ReviewsPage() {
  return (
    <>
      <PageHeader title="검수함" description="올라온 영상을 처리 상태별로 모았어요. 위반 후보는 참고용이고 판단은 직접 해요." />
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
      <Tabs tabs={FILTERS.map((f) => ({ ...f, label: `${f.label} ${count(f.value)}` }))} value={filter} onChange={setFilter} />
      <FilterBar label="검수 목록 필터">
        {!guideId && (
          <Select aria-label="가이드" value={guide} onChange={(e) => setGuide(e.target.value)}>
            <option value="">모든 가이드</option>
            {guides.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        )}
        <Select aria-label="인플루언서" value={influencer} onChange={(e) => setInfluencer(e.target.value)}>
          <option value="">모든 인플루언서</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
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
            <td>v{r.version}{r.driveUrl && <span className="text-caption"> 드라이브 링크</span>}</td>
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
