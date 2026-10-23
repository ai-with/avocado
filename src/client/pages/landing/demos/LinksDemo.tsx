import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Icon, Tabs } from "../../../ui";
import { prefersReducedMotion } from "../useInViewPlayback";
import { LINKS_DEMO as COPY, type LinkMetrics, type LinkPeriod } from "./demoCopy2";
import { DemoFrame } from "./DemoFrame";
import { stepsFromGaps, useDemoSequence } from "./useDemoSequence";
import "./links.css";

const COUNT_MS = 700;
const COPIED_MS = 1600;
const ZERO: LinkMetrics = [0, 0, 0];
const PERIOD_TABS = [...COPY.periods];
// 자동 재생: 24시간 → 3일 → 7일로 넘기고 마지막에 한 행의 링크를 복사한다
const PERIOD_BY_STEP: readonly LinkPeriod[] = ["24h", "3d", "7d", "7d"];
const COPY_STEP = 3;
const AUTO_COPY_ROW = 4;
const STEPS = stepsFromGaps([300, 2000, 2000, 1400]);

const sum = (rows: readonly LinkMetrics[]): LinkMetrics =>
  rows.reduce<LinkMetrics>((acc, r) => [acc[0] + r[0], acc[1] + r[1], acc[2] + r[2]], ZERO);
const rowsOf = (period: LinkPeriod | null) => COPY.rows.map((r) => (period ? r.data[period] : ZERO));
// 깔때기 막대는 가장 긴 기간의 클릭 합계를 100%로 둬서 기간이 늘면 막대도 자란다
const FUNNEL_MAX = sum(rowsOf("7d"))[0];

// 바뀐 값까지 숫자가 올라가거나 내려간다
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (prefersReducedMotion()) { from.current = value; setShown(value); return; }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      const eased = 1 - (1 - t) ** 3;
      const next = Math.round(origin + (value - origin) * eased);
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{shown.toLocaleString("ko-KR")}</>;
}

function useCopiedFlash() {
  const [copied, setCopied] = useState<number | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flash = useCallback((row: number) => {
    window.clearTimeout(timer.current);
    setCopied(row);
    timer.current = window.setTimeout(() => setCopied(null), COPIED_MS);
  }, []);
  return { copied, flash };
}

function useLinksState() {
  const sequence = useDemoSequence(STEPS);
  const [period, setPeriod] = useState<LinkPeriod | null>(null);
  const { copied, flash } = useCopiedFlash();
  useEffect(() => {
    setPeriod(PERIOD_BY_STEP[sequence.step] ?? null);
    if (sequence.step === COPY_STEP) flash(AUTO_COPY_ROW);
  }, [sequence.step, flash]);
  return { sequence, period, setPeriod, copied, flash };
}

function LinkTable({ rows, total, copied, onCopy }: { rows: LinkMetrics[]; total: LinkMetrics; copied: number | null; onCopy: (i: number) => void }) {
  return (
    <table className="links-table">
      <thead>
        <tr><th scope="col">{COPY.linkHead}</th>{COPY.columns.map((c) => <th key={c} scope="col" className="is-num">{c}</th>)}</tr>
      </thead>
      <tbody>
        {COPY.rows.map((r, i) => (
          <tr key={r.slug} className={copied === i ? "is-copied" : ""} onClick={() => onCopy(i)}>
            <td>
              <button type="button" className="links-name" aria-label={`${r.who} ${r.channel} 링크 복사`}>
                <span>{r.who}</span><span className="demo-label">{r.channel} · {r.slug}</span>
              </button>
              {copied === i && <span className="links-toast" role="status"><Badge tone="success"><Icon name="check" size={12} />{COPY.copied}</Badge></span>}
            </td>
            {(rows[i] ?? ZERO).map((n, k) => <td key={k} className="is-num"><CountUp value={n} /></td>)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr><th scope="row">{COPY.total}</th>{total.map((n, k) => <td key={k} className="is-num"><CountUp value={n} /></td>)}</tr>
      </tfoot>
    </table>
  );
}

function Funnel({ total }: { total: LinkMetrics }) {
  return (
    <ol className="links-funnel">
      {COPY.funnel.map((label, k) => {
        const n = total[k] ?? 0;
        return (
        <li key={label}>
          <span className="links-funnel-label">{label}</span>
          <span className="links-bar"><span className={`links-bar-fill is-${k}`} style={{ width: `${(n / FUNNEL_MAX) * 100}%` }} /></span>
          <span className="links-funnel-num"><CountUp value={n} /></span>
        </li>
        );
      })}
    </ol>
  );
}

// 인플루언서·채널별 링크 성과: 기간을 바꾸면 숫자와 깔때기가 같이 바뀐다
export function LinksDemo() {
  const { sequence, period, setPeriod, copied, flash } = useLinksState();
  const rows = rowsOf(period);
  const total = sum(rows);
  return (
    <DemoFrame label={COPY.label} frameRef={sequence.ref} onReplay={sequence.replay} className="links">
      <Tabs tabs={PERIOD_TABS} value={period ?? "24h"} onChange={setPeriod} label="기간" />
      <div className="demo-card links-card">
        <LinkTable rows={rows} total={total} copied={copied} onCopy={flash} />
        <p className="demo-label links-hint">{COPY.rowHint}</p>
      </div>
      <div className="demo-card"><Funnel total={total} /></div>
    </DemoFrame>
  );
}
