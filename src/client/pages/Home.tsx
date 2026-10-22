import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../lib/me";
import { api } from "../lib/api";
import { Button, LoadingState, PageHeader, SectionCard, Stat, StatGrid, ButtonLink } from "../ui";
import "../features/guides/guides.css";

type Counts = { guides: number; linksIssued: number; viewed: number; uploads: number; leadLinks: number; leads: number; reviewed: number };

// US-02 시작 체크리스트. 완료 여부는 데이터로 판단한다 (소요 시간은 추론값)
const STEPS: { title: string; minutes: number; to: string; done: (c: Counts) => boolean }[] = [
  { title: "가이드 만들기 (규정 입력 포함)", minutes: 10, to: "/guides/new", done: (c) => c.guides > 0 },
  { title: "인플루언서에게 가이드 URL 보내기", minutes: 5, to: "/guides", done: (c) => c.linksIssued > 0 },
  { title: "리드 링크 발급 (채널별 링크, 자료 또는 신청 폼 연결)", minutes: 5, to: "/links", done: (c) => c.leadLinks > 0 },
  { title: "영상 검수·피드백", minutes: 15, to: "/reviews", done: (c) => c.reviewed > 0 },
  { title: "성과·리드 확인", minutes: 5, to: "/leads", done: (c) => c.leads > 0 },
];

// 숫자가 0이면 숫자 대신 다음 할 일을 링크로 보여 준다
const METRICS: { label: string; value: (c: Counts) => number; next: string; to: string }[] = [
  { label: "가이드", value: (c) => c.guides, next: "첫 가이드 만들기", to: "/guides/new" },
  { label: "인플루언서 열람", value: (c) => c.viewed, next: "가이드 URL 보내기", to: "/guides" },
  { label: "업로드", value: (c) => c.uploads, next: "동의 현황 보기", to: "/guides" },
  { label: "리드", value: (c) => c.leads, next: "리드 링크 발급하기", to: "/links" },
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

function ChecklistStep({ step, done }: { step: (typeof STEPS)[number]; done: boolean }) {
  return (
    <li className={done ? "is-done" : ""}>
      <span className="check-dot" aria-hidden>{done ? "✓" : ""}</span>
      <span className="check-title">
        {step.title}
        {done && <span className="sr-only"> (완료)</span>}
      </span>
      <span className="text-caption nowrap">약 {step.minutes}분</span>
      {!done && <ButtonLink size="sm" to={step.to} aria-label={`${step.title} 시작`}>시작</ButtonLink>}
    </li>
  );
}

function StartChecklist({ counts }: { counts: Counts }) {
  const [collapsed, collapse] = useCollapsed();
  const doneCount = STEPS.filter((s) => s.done(counts)).length;
  const allDone = doneCount === STEPS.length;
  const toggle = <Button size="sm" variant="ghost" onClick={() => collapse(!collapsed)}>{collapsed ? "펼치기" : allDone ? "접기" : "나중에 하기"}</Button>;
  return (
    <SectionCard title={`시작 체크리스트 ${doneCount}/${STEPS.length}`} actions={toggle}>
      {!collapsed && (
        <ol className="checklist">
          {STEPS.map((s) => <ChecklistStep key={s.title} step={s} done={s.done(counts)} />)}
        </ol>
      )}
    </SectionCard>
  );
}

function HomeMetrics({ counts }: { counts: Counts }) {
  return (
    <StatGrid>
      {METRICS.map((m) => {
        const value = m.value(counts);
        return <Stat key={m.label} label={m.label} value={value.toLocaleString("ko-KR")} hint={value > 0 ? undefined : <Link to={m.to}>{m.next}</Link>} />;
      })}
    </StatGrid>
  );
}

export function HomePage() {
  const { me } = useMe();
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => void api.get<Counts>("/home").then(setCounts), []);
  const title = `${me?.user.name ?? ""}님, 반갑습니다`;
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
