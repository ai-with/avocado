import { useEffect, useState } from "react";
import { Badge, Button, Icon, type BadgeTone } from "../../../ui";
import { formatClock } from "../useReelClock";
import { CANDIDATES_DEMO as COPY, REEL_SECONDS, type CandidateFilter, type CandidateTone } from "./demoCopy2";
import { DemoFrame } from "./DemoFrame";
import { stepsFromGaps, useDemoSequence } from "./useDemoSequence";
import "./candidates.css";

type Decision = "adopted" | "rejected";
type DemoState = { filter: CandidateFilter; selected: number | null; decisions: Partial<Record<number, Decision>> };

const ITEMS = COPY.items;
const VIOLATION_INDEX = ITEMS.findIndex((c) => c.tone === "danger");
const INITIAL: DemoState = { filter: "all", selected: null, decisions: {} };
// 자동 재생 대본: 위반 후보만 거르기 → 항목 열기 → 채택 → 전체로 돌아와 결과 보기
const SCRIPT: ((s: DemoState) => DemoState)[] = [
  (s) => ({ ...s, filter: "danger" }),
  (s) => ({ ...s, selected: VIOLATION_INDEX }),
  (s) => ({ ...s, decisions: { ...s.decisions, [VIOLATION_INDEX]: "adopted" } }),
  (s) => ({ ...s, filter: "all" }),
];
const STEPS = stepsFromGaps([700, 900, 1100, 1100]);

const TONE_LABEL = Object.fromEntries(COPY.filters.map((f) => [f.value, f.label])) as Record<CandidateFilter, string>;
const BADGE_TONE: Record<CandidateTone, BadgeTone> = { danger: "danger", warn: "warn", success: "success", neutral: "neutral" };
const countOf = (filter: CandidateFilter) => ITEMS.filter((c) => filter === "all" || c.tone === filter).length;

function useCandidatesState() {
  const sequence = useDemoSequence(STEPS);
  const [state, setState] = useState<DemoState>(INITIAL);
  // 단계까지의 대본을 처음부터 다시 적용한다. 움직임 줄이기로 마지막 단계만 와도 최종 상태가 같다
  useEffect(() => {
    setState(SCRIPT.slice(0, sequence.step + 1).reduce((s, apply) => apply(s), INITIAL));
  }, [sequence.step]);
  return { sequence, state, setState };
}

function Filters({ value, onChange }: { value: CandidateFilter; onChange: (f: CandidateFilter) => void }) {
  return (
    <div className="cdemo-filters" role="group" aria-label="상태로 거르기">
      {COPY.filters.map((f) => (
        <button key={f.value} type="button" className={`cdemo-chip is-${f.value}`} aria-pressed={value === f.value} onClick={() => onChange(f.value)}>
          {f.label}<span className="cdemo-chip-count">{countOf(f.value)}</span>
        </button>
      ))}
    </div>
  );
}

function Timeline({ state, onPick }: { state: DemoState; onPick: (i: number) => void }) {
  return (
    <div className="cdemo-timeline" aria-label="영상 타임라인">
      <div className="cdemo-track">
        {ITEMS.map((c, i) => {
          const hidden = state.filter !== "all" && state.filter !== c.tone;
          return (
            <button key={c.seconds} type="button" className={`cdemo-marker is-${c.tone}${hidden ? " is-dim" : ""}${state.selected === i ? " is-on" : ""}`}
              style={{ left: `${(c.seconds / REEL_SECONDS) * 100}%` }} aria-label={`${formatClock(c.seconds)} ${c.title}`} onClick={() => onPick(i)} />
          );
        })}
      </div>
      <div className="cdemo-ticks demo-mono"><span>{formatClock(0)}</span><span>{formatClock(REEL_SECONDS)}</span></div>
    </div>
  );
}

function CandidateRow({ index, state, onPick }: { index: number; state: DemoState; onPick: (i: number) => void }) {
  const c = ITEMS[index];
  if (!c) return null;
  const decision = state.decisions[index];
  return (
    <li>
      <button type="button" className={`cdemo-row${state.selected === index ? " is-on" : ""}${decision === "rejected" ? " is-rejected" : ""}`}
        aria-pressed={state.selected === index} onClick={() => onPick(index)}>
        <span className="demo-mono">{formatClock(c.seconds)}</span>
        <Badge tone={BADGE_TONE[c.tone]}>{TONE_LABEL[c.tone]}</Badge>
        <span className="cdemo-row-title">{c.title}</span>
        {decision === "adopted" && <span><Badge tone="accent">{COPY.adopted}</Badge></span>}
        {decision === "rejected" && <span className="demo-label">{COPY.rejected}</span>}
      </button>
    </li>
  );
}

function EvidencePanel({ state, onDecide }: { state: DemoState; onDecide: (d: Decision) => void }) {
  const c = state.selected === null ? undefined : ITEMS[state.selected];
  if (!c || state.selected === null) return <div className="demo-card cdemo-evidence is-empty"><Icon name="mouse-pointer" size={16} />{COPY.pickHint}</div>;
  const decision = state.decisions[state.selected];
  return (
    <div key={state.selected} className="demo-card cdemo-evidence">
      <div className="cdemo-evidence-head"><span className="demo-mono">{formatClock(c.seconds)}</span><Badge tone={BADGE_TONE[c.tone]}>{TONE_LABEL[c.tone]}</Badge></div>
      <p className="demo-label">{COPY.ruleLabel}: {c.rule}</p>
      <p className="demo-label">{COPY.evidenceTitle}</p>
      <blockquote className="cdemo-quote">{c.evidence}</blockquote>
      <div className="cdemo-actions">
        <Button size="sm" aria-pressed={decision === "adopted"} onClick={() => onDecide("adopted")}>{COPY.adopt}</Button>
        <Button size="sm" variant="secondary" aria-pressed={decision === "rejected"} onClick={() => onDecide("rejected")}>{COPY.reject}</Button>
      </div>
    </div>
  );
}

// 위반 후보 목록: 거르고, 근거를 보고, 채택·기각한다
export function CandidatesDemo() {
  const { sequence, state, setState } = useCandidatesState();
  const visible = ITEMS.map((_, i) => i).filter((i) => state.filter === "all" || ITEMS[i]?.tone === state.filter);
  const pick = (i: number) => setState((s) => ({ ...s, selected: i, filter: s.filter === "all" || s.filter === ITEMS[i]?.tone ? s.filter : "all" }));
  const decide = (d: Decision) => setState((s) => (s.selected === null ? s : { ...s, decisions: { ...s.decisions, [s.selected]: d } }));

  return (
    <DemoFrame label={COPY.label} frameRef={sequence.ref} onReplay={sequence.replay} className="cdemo">
      <Filters value={state.filter} onChange={(filter) => setState((s) => ({ ...s, filter }))} />
      <Timeline state={state} onPick={pick} />
      <div className="cdemo-body">
        <div className="cdemo-list-wrap">
          <p className="demo-label cdemo-count"><Badge tone="neutral">{visible.length}건</Badge>{TONE_LABEL[state.filter]}</p>
          <ul className="cdemo-list">
            {visible.map((i) => <CandidateRow key={i} index={i} state={state} onPick={pick} />)}
          </ul>
          {visible.length === 0 && <p className="demo-label">{COPY.empty}</p>}
        </div>
        <EvidencePanel state={state} onDecide={decide} />
      </div>
    </DemoFrame>
  );
}
