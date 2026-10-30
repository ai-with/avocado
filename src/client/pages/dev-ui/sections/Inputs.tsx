import { useState } from "react";
import { NumberField, SearchField, Select, TagInput, Textarea, TextField } from "../../../ui";
import { Group, Specimen } from "../Showcase";

function TextFieldStates() {
  const [name, setName] = useState("달밤툰");
  return (
    <Group title="TextField" note="Input 확장. 포커스 칸은 카탈로그에서 포커스 모양을 흉내 낸 것">
      <Specimen label="기본, 지우기"><TextField label="채널 이름" clearable value={name} onChange={(e) => setName(e.target.value)} /></Specimen>
      <Specimen label="포커스(흉내)"><div className="dev-force-focus"><TextField label="채널 이름" defaultValue="입력 중" /></div></Specimen>
      <Specimen label="도움말, 필수"><TextField label="이메일" type="email" required hint="가입에 쓴 주소를 넣어 주세요." /></Specimen>
      <Specimen label="오류"><TextField label="영상 길이" defaultValue="0" suffix="초" error="1초 이상으로 입력해 주세요." /></Specimen>
      <Specimen label="비활성"><TextField label="워크스페이스" defaultValue="달밤 스튜디오" disabled /></Specimen>
      <Specimen label="읽기 전용"><TextField label="공유 URL" defaultValue="https://brand.example/g/abc" readOnly /></Specimen>
      <Specimen label="앞뒤 단위"><TextField label="웹사이트" prefix="https://" suffix=".com" placeholder="brand" /></Specimen>
      <Specimen label="글자 수"><TextField label="캠페인 이름" showCount maxLength={30} defaultValue="가을 신제품 리뷰" /></Specimen>
      <Specimen label="날짜(네이티브)"><TextField label="마감일" type="date" defaultValue="2026-11-15" /></Specimen>
    </Group>
  );
}

function Sizes() {
  return (
    <Group title="크기 sm · md · lg" note="TextField, Select, SelectMenu 공용. 채움형(옅은 면), 기본 md 40. lg는 TDS box 56">
      <Specimen label="sm 32px"><TextField label="작게" size="sm" placeholder="표 안 입력" /></Specimen>
      <Specimen label="md 40px"><TextField label="기본" placeholder="대부분의 폼" /></Specimen>
      <Specimen label="lg 56px"><TextField label="크게" size="lg" placeholder="공개 화면 주 입력" /></Specimen>
      <Specimen label="Select lg"><Select label="크게" size="lg" defaultValue="a"><option value="a">첫째</option></Select></Specimen>
    </Group>
  );
}

function SpecialFields() {
  const [fee, setFee] = useState<number | null>(1500000);
  const [ratio, setRatio] = useState<number | null>(1234.5);
  const [rate, setRate] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [memo, setMemo] = useState("영상 첫 3초에 제품을 보여 주세요.");
  return (
    <Group title="NumberField, SearchField, Textarea 확장">
      <Specimen label="NumberField 금액"><NumberField label="원고료" suffix="원" value={fee} onChange={setFee} clearable hint={`값: ${fee ?? "비어 있음"}`} /></Specimen>
      <Specimen label="NumberField 소수(decimal)"><NumberField label="참여 조건 금액" suffix="만 원" decimal value={ratio} onChange={setRatio} hint={`값: ${ratio ?? "비어 있음"}. "12." 같은 중간 상태 유지`} /></Specimen>
      <Specimen label="NumberField 소수 2자리(maxDecimals)"><NumberField label="환율" maxDecimals={2} value={rate} onChange={setRate} hint={`값: ${rate ?? "비어 있음"}`} /></Specimen>
      <Specimen label="NumberField 오류"><NumberField label="수량" suffix="개" value={0} onChange={() => {}} error="1개 이상으로 입력해 주세요." /></Specimen>
      <Specimen label="SearchField"><SearchField label="인플루언서 검색" placeholder="이름, 핸들" value={query} onChange={(e) => setQuery(e.target.value)} /></Specimen>
      <Specimen label="SearchField sm, 라벨 보임"><SearchField label="검색" showLabel size="sm" placeholder="검색" /></Specimen>
      <Specimen label="Textarea 자동 높이, 글자 수" wide>
        <Textarea label="촬영 메모" autoGrow showCount maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Specimen>
      <Specimen label="Textarea 글자 수 초과 오류"><Textarea label="한 줄 소개" showCount maxLength={10} defaultValue="열 글자를 넘는 소개 문장" error="10자 이내로 줄여 주세요." /></Specimen>
    </Group>
  );
}

function Tags() {
  const [tags, setTags] = useState(["언박싱", "리뷰"]);
  return (
    <Group title="TagInput" note="Enter·쉼표로 추가, x 또는 빈 칸 Backspace 로 삭제">
      <Specimen label="기본, 도움말" wide><TagInput label="키워드" hint="Enter나 쉼표로 하나씩 넣어 주세요." placeholder="키워드 입력" value={tags} onChange={setTags} /></Specimen>
      <Specimen label="오류"><TagInput label="금지어" value={[]} onChange={() => {}} required error="금지어를 하나 이상 넣어 주세요." /></Specimen>
      <Specimen label="최대 2개, 다 참"><TagInput label="채널" max={2} value={["인스타그램", "유튜브"]} onChange={() => {}} hint="2개까지 넣을 수 있어요." /></Specimen>
      <Specimen label="비활성"><TagInput label="키워드" disabled value={["리뷰"]} onChange={() => {}} /></Specimen>
    </Group>
  );
}

export function Inputs() {
  return (
    <>
      <TextFieldStates />
      <Sizes />
      <SpecialFields />
      <Tags />
    </>
  );
}
