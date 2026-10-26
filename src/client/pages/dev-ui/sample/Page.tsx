import { useState } from "react";
import { Button, EmptyState, LoadingState, PageHeader, useToast } from "../../../ui";
import { AddCandidateModal } from "./sections/AddCandidateModal";
import { CandidateFilters } from "./sections/CandidateFilters";
import { CandidateTable } from "./sections/CandidateTable";
import { useSampleCandidates, type NewCandidate } from "./useSampleCandidates";
import "./sample.css";

/** DESIGN.md만 보고 만든 시험 화면(개발 전용, 가짜 데이터). */
export function SampleCandidatesPage() {
  const s = useSampleCandidates();
  const toast = useToast();
  const [adding, setAdding] = useState(false);

  const save = (v: NewCandidate) => {
    s.add(v);
    setAdding(false);
    toast("후보를 추가했어요.", "success");
  };

  const filtered = s.query.trim() !== "" || s.status !== "";
  const empty = filtered ? (
    <EmptyState icon="search" title="조건에 맞는 후보가 없어요" description="검색어나 상태를 바꾸면 다시 보여요." action={<Button variant="secondary" onClick={s.resetFilters}>필터 지우기</Button>} />
  ) : (
    <EmptyState icon="users" title="아직 후보가 없어요" description="후보를 추가하면 여기에 모여요." action={<Button onClick={() => setAdding(true)}>후보 추가</Button>} />
  );

  return (
    <main className="sample-page">
      <PageHeader title="캠페인 후보 크리에이터" description="캠페인에 제안할 크리에이터를 모아 두고 진행 상태를 봐요." actions={<Button onClick={() => setAdding(true)}>후보 추가</Button>} />
      <div className="stack">
        <CandidateFilters query={s.query} onQuery={s.setQuery} status={s.status} onStatus={s.setStatus} />
        {s.visible === null ? <LoadingState label="후보 목록을 불러오는 중" /> : s.visible.length === 0 ? empty : <CandidateTable rows={s.visible} />}
      </div>
      {adding && <AddCandidateModal onClose={() => setAdding(false)} onSave={save} />}
    </main>
  );
}
