import { useState } from "react";
import { Button, Modal, SelectMenu, Table, type SelectOption } from "../../../ui";
import { Group, Specimen } from "../Showcase";

const CHANNELS: SelectOption[] = [
  { value: "ig", label: "인스타그램", description: "릴스·피드", group: "SNS" },
  { value: "th", label: "스레드", group: "SNS" },
  { value: "x", label: "X", description: "준비 중이에요", disabled: true, group: "SNS" },
  { value: "yt", label: "유튜브", description: "긴 영상·쇼츠", group: "영상" },
  { value: "tt", label: "틱톡", group: "영상" },
  { value: "bl", label: "네이버 블로그", group: "글" },
  { value: "br", label: "브런치", group: "글" },
  { value: "nl", label: "뉴스레터", group: "글" },
  { value: "pd", label: "팟캐스트", disabled: true },
];
const STATUS: SelectOption[] = [
  { value: "todo", label: "섭외 전" },
  { value: "asked", label: "제안함" },
  { value: "agreed", label: "수락" },
  { value: "done", label: "완료" },
];
const FEW = CHANNELS.slice(3, 6).map(({ group: _g, ...o }) => o);

function SingleStates() {
  const [a, setA] = useState<string | null>("yt");
  const [b, setB] = useState<string | null>(null);
  const [c, setC] = useState<string | null>("ig");
  return (
    <Group title="SelectMenu 단일 선택" note="선택지 8개 이상이면 검색칸이 자동으로 뜬다. 화살표·Home·End·Enter·Esc·Tab, 글자를 치면 그 글자로 이동">
      <Specimen label="기본(검색 자동, 묶음·설명·비활성)"><SelectMenu label="주 채널" options={CHANNELS} value={a} onChange={setA} hint={`값: ${a ?? "없음"}`} /></Specimen>
      <Specimen label="선택지 적음, 검색 없음, 글자로 찾기"><SelectMenu label="채널" options={FEW} value={b} onChange={setB} placeholder="채널을 골라 주세요" /></Specimen>
      <Specimen label="지우기(clearable), 필수"><SelectMenu label="대표 채널" required clearable options={CHANNELS} value={c} onChange={setC} /></Specimen>
      <Specimen label="오류"><SelectMenu label="채널" options={FEW} value={null} onChange={() => {}} error="채널을 하나 골라 주세요." /></Specimen>
      <Specimen label="비활성"><SelectMenu label="채널" options={FEW} value="yt" onChange={() => {}} disabled /></Specimen>
      <Specimen label="검색 강제(searchable), 빈 결과 문구"><SelectMenu label="채널" searchable options={FEW} value={null} onChange={() => {}} emptyText="그런 채널은 없어요" hint="없는 말을 쳐 보세요" /></Specimen>
    </Group>
  );
}

function MultiStates() {
  const [chips, setChips] = useState<string[]>(["ig", "yt", "bl"]);
  const [count, setCount] = useState<string[]>(["ig", "tt"]);
  return (
    <Group title="SelectMenu 다중 선택" note="aria-multiselectable. Enter·Space·클릭으로 넣고 빼며 목록은 열려 있다">
      <Specimen label="칩 표시(2개 + 나머지 수)"><SelectMenu label="게시 채널" multiple options={CHANNELS} value={chips} onChange={setChips} clearable /></Specimen>
      <Specimen label="N개 선택 표시(display=count)"><SelectMenu label="게시 채널" multiple display="count" options={CHANNELS} value={count} onChange={setCount} /></Specimen>
      <Specimen label="비어 있음"><SelectMenu label="게시 채널" multiple options={CHANNELS} value={[]} onChange={() => {}} placeholder="여러 개 고를 수 있어요" /></Specimen>
    </Group>
  );
}

function SizeStates() {
  const [v, setV] = useState<string | null>("asked");
  return (
    <Group title="SelectMenu 크기" note="sm은 폭이 내용만큼(표 안), lg는 공개 화면 주 입력(56)">
      <Specimen label="sm"><SelectMenu aria-label="진행 상태" size="sm" options={STATUS} value={v} onChange={setV} /></Specimen>
      <Specimen label="md"><SelectMenu label="진행 상태" options={STATUS} value={v} onChange={setV} /></Specimen>
      <Specimen label="lg"><SelectMenu label="진행 상태" size="lg" options={STATUS} value={v} onChange={setV} /></Specimen>
    </Group>
  );
}

type Row = { id: string; name: string };
const ROWS: Row[] = [{ id: "1", name: "달밤툰" }, { id: "2", name: "오늘의 집밥" }, { id: "3", name: "개발자 J" }];

function TableAndModal() {
  const [status, setStatus] = useState<Record<string, string | null>>({ "1": "todo", "2": "agreed", "3": null });
  const [open, setOpen] = useState(false);
  const [inModal, setInModal] = useState<string[]>([]);
  return (
    <Group title="SelectMenu 표 안·모달 안" note="목록은 body에 fixed로 떠서 표·모달 overflow에 잘리지 않는다. 스크롤하면 따라가고 칸이 화면 밖으로 나가면 닫힌다">
      <Specimen label="표 안 sm" wide>
        <Table columns={[{ label: "이름" }, { label: "상태" }]}>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td><SelectMenu aria-label={`${r.name} 상태`} size="sm" options={STATUS} value={status[r.id] ?? null} onChange={(next) => setStatus({ ...status, [r.id]: next })} placeholder="고르기" /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Specimen>
      <Specimen label="모달 안"><Button variant="secondary" onClick={() => setOpen(true)}>모달 열기</Button></Specimen>
      <Specimen label="화면 아래(위로 열림 확인)"><div className="dev-bottom-probe"><SelectMenu label="아래쪽 칸" options={CHANNELS} value={null} onChange={() => {}} /></div></Specimen>
      <Modal open={open} title="채널 고르기" onClose={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>확인</Button>}>
        <SelectMenu label="게시 채널" multiple options={CHANNELS} value={inModal} onChange={setInModal} hint="Esc는 목록만 닫고 모달은 남는다" />
      </Modal>
    </Group>
  );
}

export function SelectMenus() {
  return (
    <>
      <SingleStates />
      <MultiStates />
      <SizeStates />
      <TableAndModal />
    </>
  );
}
