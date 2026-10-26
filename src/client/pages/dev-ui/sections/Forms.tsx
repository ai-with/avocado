import { useState } from "react";
import { Checkbox, ChoiceChips, Input, Select, Textarea } from "../../../ui";
import { Group, Specimen } from "../Showcase";

const CHOICES = [
  { value: "a", label: "인스타툰" },
  { value: "b", label: "브이로그" },
  { value: "c", label: "리뷰" },
];

function TextFields() {
  return (
    <Group title="Input, Textarea, Select" note="기본, 도움말, 필수, 오류, 비활성">
      <Specimen label="Input 기본"><Input label="이름" placeholder="입력하세요" /></Specimen>
      <Specimen label="Input 도움말"><Input label="이메일" hint="가입에 쓴 주소" /></Specimen>
      <Specimen label="Input 필수"><Input label="전화번호" required /></Specimen>
      <Specimen label="Input 오류"><Input label="비밀번호" type="password" error="8자 이상이어야 해요." /></Specimen>
      <Specimen label="Input 비활성"><Input label="아이디" value="locked" disabled readOnly /></Specimen>
      <Specimen label="Textarea 기본"><Textarea label="메모" placeholder="내용" /></Specimen>
      <Specimen label="Textarea 오류"><Textarea label="메모" error="내용을 입력해 주세요." /></Specimen>
      <Specimen label="Select 기본">
        <Select label="분류" defaultValue="a"><option value="a">첫째</option><option value="b">둘째</option></Select>
      </Specimen>
      <Specimen label="Select 오류"><Select label="분류" error="하나를 골라 주세요."><option value="">선택</option></Select></Specimen>
      <Specimen label="Select 비활성"><Select label="분류" disabled><option>첫째</option></Select></Specimen>
    </Group>
  );
}

function Choices() {
  const [single, setSingle] = useState<string | null>("a");
  const [multi, setMulti] = useState<string[]>(["a", "c"]);
  return (
    <Group title="Checkbox, ChoiceChips">
      <Specimen label="Checkbox">
        <div className="stack-tight">
          <Checkbox label="기본" />
          <Checkbox label="선택됨" defaultChecked />
          <Checkbox label="비활성" disabled />
        </div>
      </Specimen>
      <Specimen label="ChoiceChips 하나 고르기">
        <ChoiceChips label="채널" options={CHOICES} value={single} onChange={setSingle} />
      </Specimen>
      <Specimen label="ChoiceChips 여러 개, 도움말">
        <ChoiceChips label="분야" hint="여러 개 고를 수 있어요" options={CHOICES} multiple value={multi} onChange={setMulti} />
      </Specimen>
    </Group>
  );
}

export function Forms() {
  return (
    <>
      <TextFields />
      <Choices />
    </>
  );
}
