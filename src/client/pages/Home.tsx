import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../lib/me";
import { api } from "../lib/api";
import { Badge, Button, ButtonLink, Card, Icon, LoadingState, PageHeader, Stat, StatGrid, type IconName } from "../ui";
import "./Home.css";

type Counts = { guides: number; linksIssued: number; viewed: number; uploads: number; leadLinks: number; leads: number; reviewed: number; igConnected: boolean };

// US-02 시작 체크리스트. 완료 여부는 데이터로 판단한다 (소요 시간은 추론값)
// optional 단계는 완료율에서 빼고, show 가 false 면 숨긴다
const STEPS: { title: string; minutes: number; to: string; icon: IconName; done: (c: Counts) => boolean; optional?: boolean; show?: (c: Counts) => boolean }[] = [
  { title: "가이드 만들기 (규정 입력 포함)", minutes: 10, to: "/dashboard/guides/new", icon: "file-text", done: (c) => c.guides > 0 },
  { title: "인플루언서에게 가이드 URL 보내기", minutes: 5, to: "/dashboard/guides", icon: "send", done: (c) => c.linksIssued > 0 },
  { title: "리드 링크 발급 (채널별 링크, 자료 또는 신청 폼 연결)", minutes: 5, to: "/dashboard/links", icon: "link", done: (c) => c.leadLinks > 0 },
  { title: "영상 검수·피드백", minutes: 15, to: "/dashboard/reviews", icon: "clipboard-check", done: (c) => c.reviewed > 0 },
  { title: "성과·리드 확인", minutes: 5, to: "/dashboard/leads", icon: "chart-column", done: (c) => c.leads > 0 },
  // AIWITH-374: 인스타 미연결 워크스페이스에만 보이는 선택 단계
  { title: "댓글 키워드 DM 켜기 (선택)", minutes: 5, to: "/dashboard/keyword-dm", icon: "message-circle", done: (c) => c.igConnected, optional: true, show: (c) => !c.igConnected },
];
const REQUIRED_STEPS = STEPS.filter((s) => !s.optional);

// 숫자가 0이면 숫자 대신 다음 할 일을 링크로 보여 준다
const METRICS: { label: string; value: (c: Counts) => number; next: string; to: string }[] = [
  { label: "가이드", value: (c) => c.guides, next: "첫 가이드 만들기", to: "/dashboard/guides/new" },
  { label: "인플루언서 열람", value: (c) => c.viewed, next: "가이드 URL 보내기", to: "/dashboard/guides" },
  { label: "업로드", value: (c) => c.uploads, next: "동의 현황 보기", to: "/dashboard/guides" },
  { label: "리드", value: (c) => c.leads, next: "리드 링크 발급하기", to: "/dashboard/links" },
];

const KEY = "home-checklist-collapsed";
const readCollapsed = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

function useCollapsed() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const collapse = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* 저장 불가 환경은 무시 */
    }
  };
  return [collapsed, collapse] as const;
}

function StepCard({ step, done }: { step: (typeof STEPS)[number]; done: boolean }) {
  return (
    <li className={`step-card ${done ? "is-done" : ""}`}>
      <span className="step-card-icon" aria-hidden="true"><Icon name={done ? "check" : step.icon} size={16} /></span>
      <span className="step-card-text">
        <span className="step-card-title">{step.title}</span>
        <span className="text-caption">약 {step.minutes}분</span>
      </span>
      {done ? <Badge tone="success" dot>완료</Badge> : <ButtonLink size="sm" to={step.to} aria-label={`${step.title} 시작`}>시작</ButtonLink>}
    </li>
  );
}

function StartChecklist({ counts }: { counts: Counts }) {
  const [collapsed, collapse] = useCollapsed();
  const doneCount = REQUIRED_STEPS.filter((s) => s.done(counts)).length;
  const allDone = doneCount === REQUIRED_STEPS.length;
  return (
    <Card className="get-started" aria-labelledby="get-started-title" role="region">
      <div className="get-started-head">
        <div>
          <div className="get-started-title">
            <h3 id="get-started-title">시작하기</h3>
            <Badge tone={allDone ? "success" : "neutral"}>{doneCount}/{REQUIRED_STEPS.length}</Badge>
          </div>
          <p>첫 가이드부터 첫 리드까지, 다섯 단계면 준비가 끝나요.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => collapse(!collapsed)} aria-expanded={!collapsed}>{collapsed ? "펼치기" : allDone ? "접기" : "나중에 하기"}</Button>
      </div>
      {!collapsed && (
        <ol className="get-started-grid">
          {STEPS.filter((s) => s.show?.(counts) ?? true).map((s) => <StepCard key={s.title} step={s} done={s.done(counts)} />)}
        </ol>
      )}
    </Card>
  );
}

function HomeMetrics({ counts }: { counts: Counts }) {
  return (
    <div className="home-stats">
      <StatGrid>
        {METRICS.map((m) => {
          const value = m.value(counts);
          return <Stat key={m.label} label={m.label} value={value.toLocaleString("ko-KR")} hint={value > 0 ? undefined : <Link to={m.to}>{m.next}</Link>} />;
        })}
      </StatGrid>
    </div>
  );
}

export function HomePage() {
  const { me } = useMe();
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => void api.get<Counts>("/home").then(setCounts), []);
  const title = `${me?.user.name ?? ""}님, 반가워요`;
  return (
    <>
      <PageHeader title={title} description="첫 가이드부터 첫 리드까지 순서대로 안내해 드려요." />
      {counts ? (
        <div className="stack-loose">
          <StartChecklist counts={counts} />
          <HomeMetrics counts={counts} />
        </div>
      ) : (
        <LoadingState />
      )}
    </>
  );
}
