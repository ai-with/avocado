import { Button, ButtonAnchor, ButtonLink, CopyButton, Dropdown, IconButton, type DropdownItem } from "../../../ui";
import { Group, Specimen } from "../Showcase";

const VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;
const NOOP = () => {};

const MENU_ITEMS: DropdownItem[] = [
  { label: "링크 열기", icon: "link", onSelect: NOOP },
  { label: "보내기", icon: "send", onSelect: NOOP },
  { label: "사용할 수 없음", icon: "zap", onSelect: NOOP, disabled: true },
  { label: "삭제", icon: "x", onSelect: NOOP, danger: true, divider: true },
];

function ButtonSpecimens() {
  return (
    <Group title="Button" note="변형 4종, 비활성, 로딩(폭 유지). 누르면 0.96으로 작아짐">
      {VARIANTS.map((v) => (
        <Specimen key={v} label={v}>
          <div className="row row-wrap">
            <Button variant={v}>기본</Button>
            <Button variant={v} size="sm">작게</Button>
            <Button variant={v} disabled>비활성</Button>
            <Button variant={v} loading>저장</Button>
          </div>
        </Specimen>
      ))}
    </Group>
  );
}

function ButtonSizes() {
  return (
    <Group title="Button 크기 sm · md · lg · xl" note="TDS small·medium·large·xlarge 비율. md 40은 PC 정렬 때문에 유지, lg·xl은 공개 화면 휴대폰 주 동작">
      <Specimen label="sm 32 / r8 / 13px"><div className="row"><Button size="sm">작게</Button></div></Specimen>
      <Specimen label="md 40 / r10 / 15px"><div className="row"><Button>기본</Button></div></Specimen>
      <Specimen label="lg 48 / r14 / 17px"><div className="row"><Button size="lg">크게</Button></div></Specimen>
      <Specimen label="xl 56 / r16 / 17px"><div className="row"><Button size="xl">가장 크게</Button></div></Specimen>
      <Specimen label="xl 폭 전체, 보조" wide><Button size="xl" variant="secondary" className="dev-full">공개 화면 아래 버튼</Button></Specimen>
    </Group>
  );
}

function LinkSpecimens() {
  return (
    <Group title="IconButton, ButtonLink, ButtonAnchor, CopyButton">
      <Specimen label="IconButton">
        <div className="row">
          <IconButton icon="plus" label="추가" />
          <IconButton icon="search" label="검색" variant="secondary" />
          <IconButton icon="x" label="닫기(비활성)" disabled />
        </div>
      </Specimen>
      <Specimen label="ButtonLink / ButtonAnchor">
        <div className="row">
          <ButtonLink to="/dev/ui">앱 안 이동</ButtonLink>
          <ButtonAnchor href="#top" variant="ghost">바깥 링크</ButtonAnchor>
        </div>
      </Specimen>
      <Specimen label="CopyButton">
        <div className="row">
          <CopyButton text="https://example.com" />
          <CopyButton text="https://example.com" disabled />
        </div>
      </Specimen>
    </Group>
  );
}

export function Actions() {
  return (
    <>
      <ButtonSpecimens />
      <ButtonSizes />
      <LinkSpecimens />
      <Group title="Dropdown" note="열림 상태는 직접 눌러 확인. 항목: 기본, 비활성, 위험 + 구분선">
        <Specimen label="align start">
          <Dropdown items={MENU_ITEMS} label="메뉴 열기" triggerClassName="btn btn-secondary btn-md">메뉴</Dropdown>
        </Specimen>
        <Specimen label="align end, 안내 줄">
          <Dropdown items={MENU_ITEMS} label="메뉴 열기" align="end" header="demo@example.com" triggerClassName="btn btn-secondary btn-md">메뉴</Dropdown>
        </Specimen>
      </Group>
    </>
  );
}
