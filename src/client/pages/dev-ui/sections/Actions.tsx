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
    <Group title="Button" note="변형 4종 x 크기 2종, 비활성">
      {VARIANTS.map((v) => (
        <Specimen key={v} label={v}>
          <div className="row row-wrap">
            <Button variant={v}>기본</Button>
            <Button variant={v} size="sm">작게</Button>
            <Button variant={v} disabled>비활성</Button>
          </div>
        </Specimen>
      ))}
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
