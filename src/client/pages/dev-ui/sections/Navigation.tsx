import { useState } from "react";
import { ActionBar, Button, FilterBar, Input, PageHeader, Select, Tabs } from "../../../ui";
import { Group, Specimen } from "../Showcase";

const TABS = [
  { value: "all", label: "전체" },
  { value: "open", label: "진행 중" },
  { value: "done", label: "완료" },
];

export function Navigation() {
  const [tab, setTab] = useState("all");
  return (
    <Group title="PageHeader, FilterBar, ActionBar, Tabs">
      <Specimen label="PageHeader 제목만" wide><PageHeader title="가이드" /></Specimen>
      <Specimen label="PageHeader 설명, 동작, 뒤로가기" wide>
        <PageHeader title="가이드 상세" description="설명 문장" back={{ to: "/dev/ui", label: "목록" }} actions={<Button>저장</Button>} />
      </Specimen>
      <Specimen label="FilterBar" wide>
        <FilterBar actions={<Button variant="ghost">초기화</Button>}>
          <Input aria-label="검색" placeholder="검색" />
          <Select aria-label="상태"><option>전체</option><option>완료</option></Select>
        </FilterBar>
      </Specimen>
      <Specimen label="ActionBar 상태 문구" wide>
        <ActionBar status="저장하지 않은 변경이 있어요"><Button variant="ghost">취소</Button><Button>저장</Button></ActionBar>
      </Specimen>
      <Specimen label="Tabs" wide><Tabs tabs={TABS} value={tab} onChange={setTab} label="상태 탭" /></Specimen>
    </Group>
  );
}
