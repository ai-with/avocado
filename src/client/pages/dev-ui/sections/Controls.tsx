import { useState } from "react";
import { Checkbox, RadioGroup, SegmentedControl, Switch } from "../../../ui";
import { Group, Specimen } from "../Showcase";

const PAY = [
  { value: "fixed", label: "고정 원고료", description: "콘텐츠 하나당 정한 금액" },
  { value: "cpa", label: "성과형", description: "링크로 생긴 가입 수만큼" },
  { value: "gift", label: "제품 협찬", description: "제품만 보내요", disabled: true },
] as const;
type Pay = (typeof PAY)[number]["value"];
const PERIODS = [{ value: "7", label: "7일" }, { value: "30", label: "30일" }, { value: "90", label: "90일" }];
const VIEWS = [{ value: "table", label: "표" }, { value: "card", label: "카드" }, { value: "calendar", label: "달력으로 보기" }];

function Radios() {
  const [pay, setPay] = useState<Pay | null>("fixed");
  return (
    <Group title="RadioGroup" note="화살표 키로 이동·선택(네이티브). 모양은 TDS Checkbox.Circle(24, 원 22)">
      <Specimen label="세로, 설명, 비활성 항목"><RadioGroup label="보상 방식" options={[...PAY]} value={pay} onChange={setPay} /></Specimen>
      <Specimen label="가로, 오류"><RadioGroup label="성별 공개" direction="row" required options={[{ value: "y", label: "공개" }, { value: "n", label: "비공개" }]} value={null} onChange={() => {}} error="하나를 골라 주세요." /></Specimen>
      <Specimen label="전체 비활성"><RadioGroup label="언어" disabled options={[{ value: "ko", label: "한국어" }, { value: "en", label: "영어" }]} value="ko" onChange={() => {}} /></Specimen>
    </Group>
  );
}

function Toggles() {
  const [notify, setNotify] = useState(true);
  const [publicLink, setPublicLink] = useState(false);
  return (
    <Group title="Switch, Checkbox 확장" note="Switch 는 Space 로 토글. 꺼짐 손잡이 16, 켜짐 24(TDS 실측)">
      <Specimen label="Switch 켜짐·꺼짐">
        <div className="stack-tight">
          <Switch label="새 업로드 알림" checked={notify} onChange={setNotify} />
          <Switch label="링크 공개" description="링크가 있으면 누구나 볼 수 있어요." checked={publicLink} onChange={setPublicLink} />
        </div>
      </Specimen>
      <Specimen label="Switch 비활성, 라벨 숨김">
        <div className="stack-tight">
          <Switch label="결제 알림" checked disabled onChange={() => {}} />
          <Switch label="표 행 공개" hideLabel checked={false} onChange={() => {}} />
        </div>
      </Specimen>
      <Specimen label="Checkbox 설명, 일부 선택">
        <div className="stack-tight">
          <Checkbox label="전체 선택" indeterminate onChange={() => {}} />
          <Checkbox label="마케팅 수신 동의" description="광고 알림톡을 받아요. 언제든 끌 수 있어요." defaultChecked />
        </div>
      </Specimen>
    </Group>
  );
}

function Segments() {
  const [period, setPeriod] = useState("30");
  const [view, setView] = useState("table");
  return (
    <Group title="SegmentedControl" note="화살표 키로 이동·선택(네이티브 라디오)">
      <Specimen label="md, 같은 폭"><SegmentedControl label="기간" options={PERIODS} value={period} onChange={setPeriod} /></Specimen>
      <Specimen label="sm, fluid"><SegmentedControl label="보기" size="sm" fluid options={VIEWS} value={view} onChange={setView} /></Specimen>
      <Specimen label="비활성"><SegmentedControl label="기간" disabled options={PERIODS} value="7" onChange={() => {}} /></Specimen>
    </Group>
  );
}

export function Controls() {
  return (
    <>
      <Radios />
      <Toggles />
      <Segments />
    </>
  );
}
