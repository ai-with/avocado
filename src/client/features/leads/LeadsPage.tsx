import { useEffect, useState } from "react";
import { Button, PageHeader, Tabs, ButtonAnchor, LoadingState } from "../../ui";
import { LeadDrawer } from "./common";
import { NO_FILTERS, useLeads, type Filters, type Group } from "./useLeads";
import { ContactsTab } from "./sections/ContactsTab";
import { GroupsTab } from "./sections/GroupsTab";
import { TagsTab } from "./sections/TagsTab";
import { GroupModal } from "./sections/GroupModal";
import { ImportModal } from "./sections/ImportModal";
import { AddLeadModal } from "./sections/AddLeadModal";
import "./leads.css";
import { SheetsExportControl } from "../google-sheets/SheetsExportControl";

type Tab = "contacts" | "groups" | "tags";
const TABS: { value: Tab; label: string }[] = [{ value: "contacts", label: "연락처" }, { value: "groups", label: "그룹" }, { value: "tags", label: "태그" }];

// /leads: 연락처 표, 필터, 태그, 그룹, CSV 가져오기·내보내기, 상세 드로어 (F-52)
export function LeadsPage() {
  const { leads, lk, groups, filters, setFilters, query, load, act, error, groupError, groupsLoading, lookupCursors, moreLookup, groupCursor, moreGroups, pageKey, page, hasPrevious, hasNext, nextPage, previousPage } = useLeads();
  const [tab, setTab] = useState<Tab>("contacts");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<Partial<Group> | null>(null);
  useEffect(() => setSelected(new Set()), [pageKey]);
  const reload = () => void load();
  const lookupActions = (kinds: (keyof typeof lk)[]) => <div className="row row-wrap">{kinds.filter((kind) => lookupCursors[kind]).map((kind) => <Button key={kind} variant="ghost" size="sm" onClick={() => void moreLookup(kind)}>{({ guides: "가이드", influencers: "인플루언서", channels: "채널", tags: "태그", contents: "콘텐츠" })[kind]} 필터 더 보기</Button>)}</div>;
  // 그룹·태그 탭의 '리드 보기': 그 조건 하나만 걸고 연락처 탭으로 간다
  const showContacts = (patch: Partial<Filters>) => (setFilters({ ...NO_FILTERS, ...patch }), setTab("contacts"));

  return (
    <>
      <PageHeader title="리드" description="링크·자료·폼·댓글 DM으로 들어온 사람이 한 목록에 모여요. 같은 이메일은 한 명으로 합치고 출처는 쌓아요." actions={<HeaderActions query={query} onImport={() => setImportOpen(true)} onAdd={() => setAddOpen(true)} />} />
      <Tabs<Tab> tabs={TABS} value={tab} onChange={setTab} />
      {tab === "contacts" && <div className="stack"><ContactsTab leads={leads} lk={lk} groups={groups} filters={filters} onFilters={setFilters} selected={selected} onSelect={setSelected} onOpen={setDrawer} act={act} error={error} onRetry={reload} />
        <div className="row row-wrap"><span className="text-caption">{page}페이지 · 선택은 현재 페이지에만 적용해요.</span><Button variant="secondary" size="sm" disabled={!hasPrevious || !leads} onClick={previousPage}>이전 페이지</Button><Button variant="secondary" size="sm" disabled={!hasNext || !leads} onClick={nextPage}>다음 페이지</Button></div>
        <div className="row row-wrap">{Object.entries(lookupCursors).filter(([, cursor]) => cursor).map(([kind]) => <Button key={kind} variant="ghost" size="sm" onClick={() => void moreLookup(kind as keyof typeof lk)}>{({ guides: "가이드", influencers: "인플루언서", channels: "채널", tags: "태그", contents: "콘텐츠" } as Record<string, string>)[kind]} 필터 더 보기</Button>)}{groupCursor && <Button variant="ghost" size="sm" onClick={() => void moreGroups()}>그룹 더 보기</Button>}</div></div>}
      {tab === "groups" && (groupsLoading ? <LoadingState pattern="table" /> : groupError ? <p role="alert" className="field-error">{groupError}</p> : <><GroupsTab groups={groups} lk={lk} onNew={() => setEditGroup({ name: "", rules: { all: [] } })} onEdit={setEditGroup} onView={(groupId) => showContacts({ groupId })} act={act} />{groupCursor && <Button variant="secondary" onClick={() => void moreGroups()}>그룹 더 보기</Button>}</>)}
      {tab === "tags" && <><TagsTab tags={lk.tags} onView={(tagId) => showContacts({ tagId })} act={act} />{lookupActions(["tags"])}</>}

      {drawer && <LeadDrawer id={drawer} lk={lk} onClose={() => setDrawer(null)} onChanged={reload} lookupActions={lookupActions(["tags"])} />}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onDone={reload} />}
      {addOpen && <AddLeadModal onClose={() => setAddOpen(false)} onDone={reload} />}
      {editGroup && <GroupModal group={editGroup} lk={lk} onClose={() => setEditGroup(null)} onSaved={reload} lookupActions={lookupActions(["guides", "influencers", "channels", "tags"])} />}
    </>
  );
}

function HeaderActions({ query, onImport, onAdd }: { query: string; onImport: () => void; onAdd: () => void }) {
  return (
    <>
      <Button variant="secondary" onClick={onImport}>CSV 가져오기</Button>
      <ButtonAnchor href={`/api/leads/export?${query}`}>CSV 내보내기</ButtonAnchor>
      <SheetsExportControl kind="leads" query={query} />
      <Button onClick={onAdd}>리드 직접 추가</Button>
    </>
  );
}
