import { useCallback, useEffect, useState } from "react";
import { EmptyState, LoadingState, Table, useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import { MAIN_METRICS, METRIC_LABELS, OFFSET_LABELS, SNAPSHOT_OFFSETS } from "../../../shared/performance";
import type { Filters, PerfQuery, PerfRow } from "./perfTypes";
import { PerfFilterBar } from "./sections/PerfFilterBar";
import { PerfTableRow } from "./sections/PerfTableRow";
import { PostedAtModal } from "./sections/PostedAtModal";
import "./performance.css";

export type { PerfRow } from "./perfTypes";

function usePerformance(guideId: string | undefined) {
  const [rows, setRows] = useState<PerfRow[] | null>(null);
  const [filters, setFilters] = useState<Filters>({ guides: [], influencers: [] });
  const [f, setF] = useState<PerfQuery>({ guideId: guideId ?? "", influencerId: "", format: "" });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const load = useCallback(async () => {
    const d = await api.get<{ rows: PerfRow[]; filters: Filters }>(`/performance${qs ? `?${qs}` : ""}`);
    setRows(d.rows);
    setFilters(d.filters);
  }, [qs]);
  useEffect(() => void load(), [load]);
  return { rows, filters, f, setF, qs, load };
}

function PerfTableHead() {
  return (
    <thead>
      <tr>
        <th rowSpan={2}>인플루언서</th>
        <th rowSpan={2}>형식</th>
        <th rowSpan={2}>게시 시각</th>
        {SNAPSHOT_OFFSETS.map((o) => <th key={o} colSpan={4} className="perf-group">{OFFSET_LABELS[o]}{o === 24 && <span className="text-caption"> (조회 시각 값)</span>}</th>)}
        <th rowSpan={2} className="num">클릭</th>
        <th rowSpan={2} className="num">리드</th>
        <th rowSpan={2}>수집 경로</th>
      </tr>
      <tr>{SNAPSHOT_OFFSETS.flatMap((o) => MAIN_METRICS.map((m) => <th key={`${o}${m}`} className="num">{METRIC_LABELS[m]}</th>))}</tr>
    </thead>
  );
}

// 성과표 (F-49, W08). guideId 를 넘기면 가이드 상세 '성과' 탭으로 쓴다
export function PerformanceTable({ guideId }: { guideId?: string }) {
  const toast = useToast();
  const { me } = useMe();
  const canEdit = me?.role === "owner" || me?.role === "editor";
  const { rows, filters, f, setF, qs, load } = usePerformance(guideId);
  const [editing, setEditing] = useState<PerfRow | null>(null);
  const onSaved = async () => { setEditing(null); toast("게시 시각을 저장하고 스냅샷을 다시 예약했어요.", "success"); await load(); };

  return (
    <div className="stack">
      <PerfFilterBar f={f} setF={setF} filters={filters} qs={qs} showGuide={!guideId} />
      <p className="text-caption">24시간 값은 조회 시각 값이에요. 플랫폼 집계는 최대 48시간 늦을 수 있어요. 미연결 계정은 저장·공유를 받을 수 없어 빈칸으로 보여요.</p>
      {rows === null ? <LoadingState pattern="table" /> : rows.length === 0 ? (
        <EmptyState title="아직 게시물이 없어요" description="인플루언서가 게시물 URL을 넣거나 가이드 상세에서 직접 넣으면 24시간·3일·7일 성과가 여기에 쌓여요." />
      ) : (
        <Table className="perf-table">
          <PerfTableHead />
          <tbody>
            {rows.map((r) => <PerfTableRow key={r.contentId} r={r} showGuide={!guideId} onEdit={canEdit ? () => setEditing(r) : undefined} />)}
          </tbody>
        </Table>
      )}
      <PostedAtModal row={editing} onClose={() => setEditing(null)} onSaved={onSaved} onError={(e) => toast(errorMessage(e), "danger")} />
    </div>
  );
}
