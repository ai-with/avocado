import { Badge, Button, Card, EmptyState, Icon, LoadingState, SectionCard, Stat, StatGrid, Table, type BadgeSize, type BadgeTone, type IconName } from "../../../ui";
import { Group, Specimen } from "../Showcase";

const TONES: BadgeTone[] = ["neutral", "accent", "success", "warn", "danger", "info"];
const BADGE_SIZES: { size: BadgeSize; label: string }[] = [
  { size: "xs", label: "xs 21 / 10px 600 / r9" },
  { size: "sm", label: "sm 24 / 12px 700 / r11 (기본)" },
  { size: "md", label: "md 25.5 / 13px 700 / r12" },
  { size: "lg", label: "lg 29 / 14px 700 / r13" },
];
const SAMPLE_ICONS: IconName[] = ["house", "users", "link", "send", "search", "plus", "x", "globe"];
const COLUMNS = [{ label: "이름", icon: "users" as const }, { label: "상태" }, { label: "건수", num: true }];

function Badges() {
  return (
    <Group title="Badge" note="톤 6종, 점 표시, 크기 4단(TDS xsmall·small·medium·large 실측)">
      {BADGE_SIZES.map(({ size, label }) => (
        <Specimen key={size} label={label}><div className="row"><Badge size={size} tone="accent">진행 중</Badge></div></Specimen>
      ))}
      {TONES.map((tone) => (
        <Specimen key={tone} label={tone}>
          <div className="row">
            <Badge tone={tone}>{tone}</Badge>
            <Badge tone={tone} dot>{tone}</Badge>
          </div>
        </Specimen>
      ))}
    </Group>
  );
}

function Containers() {
  return (
    <Group title="Card, SectionCard, Stat, Table">
      <Specimen label="Card"><Card>카드 본문</Card></Specimen>
      <Specimen label="SectionCard" wide>
        <SectionCard title="제목" description="설명 문장" actions={<Button size="sm">동작</Button>}>본문</SectionCard>
      </Specimen>
      <Specimen label="Stat / StatGrid" wide>
        <StatGrid>
          <Stat label="가입" value="128" hint="지난주 대비 +12" />
          <Stat label="전환율" value="4.2%" />
        </StatGrid>
      </Specimen>
      <Specimen label="Table" wide>
        <Table columns={COLUMNS}>
          <tbody>
            <tr><td>달밤툰</td><td><Badge tone="success">완료</Badge></td><td className="num">12</td></tr>
            <tr><td>야근일기</td><td><Badge tone="warn">대기</Badge></td><td className="num">3</td></tr>
          </tbody>
        </Table>
      </Specimen>
    </Group>
  );
}

function States() {
  return (
    <Group title="EmptyState, LoadingState, Icon">
      <Specimen label="EmptyState 기본" wide><EmptyState title="아직 없어요" description="첫 항목을 만들어 보세요." /></Specimen>
      <Specimen label="EmptyState 아이콘, 동작" wide>
        <EmptyState icon="users" title="인플루언서가 없어요" description="초대하면 여기에 보여요." action={<Button>초대하기</Button>} />
      </Specimen>
      <Specimen label="EmptyState compact" wide><EmptyState compact title="결과가 없어요" /></Specimen>
      <Specimen label="LoadingState 기본" wide><LoadingState /></Specimen>
      <Specimen label="LoadingState 5줄" wide><LoadingState lines={5} /></Specimen>
      <Specimen label="Icon 크기 18(기본), 24" wide>
        <div className="row row-wrap">
          {SAMPLE_ICONS.map((n) => <Icon key={n} name={n} />)}
          {SAMPLE_ICONS.map((n) => <Icon key={`l-${n}`} name={n} size={24} />)}
        </div>
      </Specimen>
    </Group>
  );
}

export function Display() {
  return (
    <>
      <Badges />
      <Containers />
      <States />
    </>
  );
}
