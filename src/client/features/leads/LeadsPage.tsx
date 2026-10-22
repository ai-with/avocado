import { useState } from "react";
import { Button, PageHeader, Tabs, ButtonAnchor } from "../../ui";
import { LeadDrawer } from "./common";
import { NO_FILTERS, useLeads, type Filters, type Group } from "./useLeads";
import { ContactsTab } from "./sections/ContactsTab";
import { GroupsTab } from "./sections/GroupsTab";
import { TagsTab } from "./sections/TagsTab";
import { GroupModal } from "./sections/GroupModal";
import { ImportModal } from "./sections/ImportModal";
import { AddLeadModal } from "./sections/AddLeadModal";
import "./leads.css";

type Tab = "contacts" | "groups" | "tags";
const TABS: { value: Tab; label: string }[] = [{ value: "contacts", label: "연락처" }, { value: "groups", label: "그룹" }, { value: "tags", label: "태그" }];

// /leads: 연락처 표, 필터, 태그, 그룹, CSV 가져오기·내보내기, 상세 드로어 (F-52)
export function LeadsPage() {
  const { leads, lk, groups, filters, setFilters, query, load, act } = useLeads();
  const [tab, setTab] = useState<Tab>("contacts");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<Partial<Group> | null>(null);
  const reload = () => void load();
  // 그룹·태그 탭의 '리드 보기': 그 조건 하나만 걸고 연락처 탭으로 간다
  const showContacts = (patch: Partial<Filters>) => (setFilters({ ...NO_FILTERS, ...patch }), setTab("contacts"));

  return (
    <>
      <PageHeader title="리드" description="링크·자료·폼·댓글 DM으로 들어온 사람이 한 목록에 모여요. 같은 이메일은 한 명으로 합치고 출처는 쌓아요." actions={<HeaderActions query={query} onImport={() => setImportOpen(true)} onAdd={() => setAddOpen(true)} />} />
      <Tabs<Tab> tabs={TABS} value={tab} onChange={setTab} />
      {tab === "contacts" && <ContactsTab leads={leads} lk={lk} groups={groups} filters={filters} onFilters={setFilters} selected={selected} onSelect={setSelected} onOpen={setDrawer} act={act} />}
      {tab === "groups" && <GroupsTab groups={groups} lk={lk} onNew={() => setEditGroup({ name: "", rules: { all: [] } })} onEdit={setEditGroup} onView={(groupId) => showContacts({ groupId })} act={act} />}
      {tab === "tags" && <TagsTab tags={lk.tags} onView={(tagId) => showContacts({ tagId })} act={act} />}

      {drawer && <LeadDrawer id={drawer} lk={lk} onClose={() => setDrawer(null)} onChanged={reload} />}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onDone={reload} />}
      {addOpen && <AddLeadModal onClose={() => setAddOpen(false)} onDone={reload} />}
      {editGroup && <GroupModal group={editGroup} lk={lk} onClose={() => setEditGroup(null)} onSaved={reload} />}
    </>
  );
}

function HeaderActions({ query, onImport, onAdd }: { query: string; onImport: () => void; onAdd: () => void }) {
  return (
    <>
      <Button variant="secondary" onClick={onImport}>CSV 가져오기</Button>
      <ButtonAnchor href={`/api/leads/export?${query}`}>CSV 내보내기</ButtonAnchor>
      <Button onClick={onAdd}>리드 직접 추가</Button>
    </>
  );
}
