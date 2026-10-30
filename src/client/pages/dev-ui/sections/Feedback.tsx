import { Avatar, Badge, Disclosure, IconButton, ListRow, Loader, LoadingState, ProgressBar, Skeleton, Spinner, Switch, Tooltip } from "../../../ui";
import { Group, Specimen } from "../Showcase";

function Rows() {
  return (
    <Group title="ListRow, Avatar">
      <Specimen label="ListRow 정보 행" wide>
        <div>
          <ListRow leading={<Avatar name="달밤툰" />} title="달밤툰" description="@dalbam_toon · 인스타그램" trailing={<Badge tone="success">연결됨</Badge>} />
          <ListRow leading={<Avatar name="야근일기" />} title="야근일기" description="연결 대기" trailing={<Switch label="야근일기 알림" hideLabel checked onChange={() => {}} />} />
        </div>
      </Specimen>
      <Specimen label="ListRow 누르는 행, 비활성" wide>
        <div>
          <ListRow title="결제 수단" description="카드 1개" withArrow onClick={() => {}} />
          <ListRow title="세금계산서" description="준비 중이에요" withArrow disabled onClick={() => {}} />
        </div>
      </Specimen>
      <Specimen label="Avatar sm · md · lg">
        <div className="row"><Avatar name="studio" size="sm" /><Avatar name="브랜드" /><Avatar name="jay" size="lg" /></div>
      </Specimen>
    </Group>
  );
}

function Progress() {
  return (
    <Group title="ProgressBar, Spinner, Tooltip">
      <Specimen label="ProgressBar 값 표시"><ProgressBar label="업로드" value={0.42} showValue /></Specimen>
      <Specimen label="ProgressBar sm, 톤"><div className="stack-tight"><ProgressBar label="완료" size="sm" tone="success" value={1} /><ProgressBar label="실패" size="sm" tone="danger" value={0.3} /></div></Specimen>
      <Specimen label="Spinner sm · md · lg · xl (TDS Loader, 0.7초 뒤 나타남)"><div className="row"><Spinner size="sm" /><Spinner label="불러오는 중" /><Spinner size="lg" /><Spinner size="xl" /></div></Specimen>
      <Specimen label="Loader 문구 (화면 전체 기다림)"><Loader label="김토스님의 카드를 불러오고 있어요" /></Specimen>
      <Specimen label="Tooltip(올리거나 Tab)">
        <div className="row">
          <Tooltip content="전환율은 가입 수를 클릭 수로 나눈 값이에요."><IconButton icon="circle-help" label="전환율 설명" /></Tooltip>
          <Tooltip content="아래에 떠요" placement="bottom"><IconButton icon="circle-help" label="아래 툴팁" /></Tooltip>
        </div>
      </Specimen>
    </Group>
  );
}

function Skeletons() {
  return (
    <Group title="LoadingState 패턴" note="TDS Skeleton 모듈 조합: lines(기본), list(아이콘 줄), card, table(표 줄), detail(제목·부제 + 큰 줄). 불투명도 1~0.2·크기 1~0.96 2.4초">
      <Specimen label="list"><LoadingState pattern="list" /></Specimen>
      <Specimen label="card"><LoadingState pattern="card" lines={1} /></Specimen>
      <Specimen label="table" wide><LoadingState pattern="table" lines={4} /></Specimen>
      <Specimen label="detail"><LoadingState pattern="detail" lines={2} /></Specimen>
      <Specimen label="Skeleton 조각: title · text · circle · rect"><div className="stack-tight"><Skeleton shape="title" /><Skeleton /><Skeleton shape="circle" /><Skeleton shape="rect" width={160} /></div></Specimen>
    </Group>
  );
}

function Disclosures() {
  return (
    <Group title="Disclosure" note="네이티브 details. Enter·Space 로 열고 닫음">
      <Specimen label="접힘, 개수" wide>
        <div>
          <Disclosure title="적용된 브랜드 규칙" count={12} description="검수 사전에서 가져옴">
            <p>경쟁사 이름을 말하지 않아요.</p>
            <p>가격은 정가 기준으로 말해요.</p>
          </Disclosure>
          <Disclosure title="지난 버전" count={3} defaultOpen>
            <p className="text-secondary">2026.10.28 첫 업로드</p>
          </Disclosure>
        </div>
      </Specimen>
    </Group>
  );
}

export function Feedback() {
  return (
    <>
      <Rows />
      <Progress />
      <Skeletons />
      <Disclosures />
    </>
  );
}
