import { useState } from "react";
import { useParams } from "react-router-dom";
import { EmptyState, LoadingState, PageHeader, Tabs } from "../../ui";
import { useMe } from "../../lib/me";
import { TERM_KINDS, TERM_KIND_LABELS, type BrandTerm, type TermKind } from "../../../shared/brand-terms";
import { emptyTerm, useBrandTerms, type TermInput } from "./api";
import { TermsTab } from "./sections/TermsTab";
import { LegalTab } from "./sections/LegalTab";
import { TermModal } from "./sections/TermModal";

type Tab = TermKind | "legal";

// /dashboard/settings/brands/:brandId/terms 브랜드 검수 사전 (TASK-079). 이 브랜드의 모든 캠페인 검수에 들어간다
export function BrandTermsPage() {
  const { brandId = "" } = useParams();
  const { me } = useMe();
  const canEdit = me?.role === "owner" || me?.role === "editor";
  const { data, error, reload } = useBrandTerms(brandId);
  const [tab, setTab] = useState<Tab>("required_ment");
  const [editing, setEditing] = useState<(TermInput & { id?: string }) | null>(null);
  const back = { to: "/dashboard/settings/brands", label: "브랜드" };

  if (error) return <><PageHeader title="검수 사전" back={back} /><EmptyState title="사전을 열 수 없어요" description={error} /></>;
  if (!data) return <><PageHeader title="검수 사전" back={back} /><LoadingState pattern="table" label="검수 사전을 불러오는 중" /></>;
  const count = (k: TermKind) => data.terms.filter((t) => t.kind === k).length;
  const tabs = [...TERM_KINDS.map((k) => ({ value: k as Tab, label: `${TERM_KIND_LABELS[k]} ${count(k)}` })), { value: "legal" as Tab, label: "법규 기본 목록" }];
  const edit = (t: BrandTerm) => setEditing(t);
  return (
    <>
      <PageHeader title={`${data.brand.name} 검수 사전`} description="여기 넣은 항목은 이 브랜드의 모든 캠페인 영상 검수에 자동으로 들어가요. 캠페인마다 끌 수도 있어요." back={back} />
      <div className="stack">
        <Tabs<Tab> tabs={tabs} value={tab} onChange={setTab} label="사전 종류" />
        {tab === "legal" ? (
          <LegalTab brandId={brandId} preset={data.brand.legalPreset} canEdit={canEdit} reload={reload} />
        ) : (
          <TermsTab brandId={brandId} kind={tab} terms={data.terms.filter((t) => t.kind === tab)} canEdit={canEdit} onAdd={() => setEditing(emptyTerm(tab))} onEdit={edit} reload={reload} />
        )}
      </div>
      {editing && <TermModal brandId={brandId} initial={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </>
  );
}
