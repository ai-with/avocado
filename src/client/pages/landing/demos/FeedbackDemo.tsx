import { useEffect, useState } from "react";
import { Badge, Button, Icon } from "../../../ui";
import { FEEDBACK_DEMO as COPY, REEL_POSTER, REEL_VIDEO } from "./demoCopy2";
import { DemoFrame } from "./DemoFrame";
import { stepsFromGaps, useDemoSequence } from "./useDemoSequence";
import "./feedback.css";

const TYPE_GAP_MS = 45;
const TYPE_CHARS = COPY.ko.length;
// 단계 이름과 앞 단계로부터의 간격(ms). 타이핑은 글자마다 한 단계
const PHASES: readonly (readonly [name: string, gap: number])[] = [
  ["cursor", 500], ["draw", 400], ["comment", 1000],
  ...Array.from({ length: TYPE_CHARS }, () => ["type", TYPE_GAP_MS] as const),
  ["translating", 300], ["translated", 800], ["sent", 1000], ["reflected", 1000], ["v2", 900], ["compare", 1200],
];
const STEPS = stepsFromGaps(PHASES.map(([, gap]) => gap));
const indexOf = (name: string) => PHASES.findIndex(([n]) => n === name);
const COMMENT_INDEX = indexOf("comment");

type Phase = { reached: (name: string) => boolean; typed: number; compare: boolean; sent: boolean };

function useFeedbackPhase() {
  const sequence = useDemoSequence<HTMLDivElement>(STEPS);
  const [compareOverride, setCompareOverride] = useState<boolean | null>(null);
  const [manualSent, setManualSent] = useState(false);
  // 다시 볼 때마다 사용자가 바꾼 값을 지운다
  useEffect(() => {
    if (sequence.step >= 0) return;
    setCompareOverride(null);
    setManualSent(false);
  }, [sequence.step]);
  const reached = (name: string) => sequence.step >= indexOf(name);
  const phase: Phase = {
    reached,
    typed: Math.min(TYPE_CHARS, Math.max(0, sequence.step - COMMENT_INDEX)),
    compare: compareOverride ?? reached("compare"),
    sent: manualSent || reached("sent"),
  };
  return { sequence, phase, setCompareOverride, setManualSent };
}

const BOX = COPY.box;
const boxStyle = (drawn: boolean) => ({ left: `${BOX.left}%`, top: `${BOX.top}%`, width: drawn ? `${BOX.width}%` : 0, height: drawn ? `${BOX.height}%` : 0 });
const cursorStyle = (drawn: boolean) => ({ left: `${BOX.left + (drawn ? BOX.width : 0)}%`, top: `${BOX.top + (drawn ? BOX.height : 0)}%` });

function MarkupBox({ drawn, showNumber }: { drawn: boolean; showNumber: boolean }) {
  return (
    <span className="fdemo-box" style={boxStyle(drawn)} aria-hidden="true">
      {showNumber && <span className="fdemo-box-no">1</span>}
    </span>
  );
}

function BrandFrame({ phase, onRestart }: { phase: Phase; onRestart: () => void }) {
  const drawn = phase.reached("draw");
  const cursorOn = phase.reached("cursor") && !phase.reached("comment");
  return (
    <div className="fdemo-frame-col">
      <button type="button" className="fdemo-frame" onClick={onRestart} aria-label={COPY.hint}>
        <img src={REEL_POSTER} alt="" className="fdemo-media" />
        {phase.reached("cursor") && <MarkupBox drawn={drawn} showNumber={phase.reached("comment")} />}
        {cursorOn && <span className="fdemo-cursor" style={cursorStyle(drawn)}><Icon name="mouse-pointer" size={18} /></span>}
        <span className="fdemo-frame-tag">v1</span>
      </button>
      <p className="demo-label fdemo-hint"><Icon name="mouse-pointer" size={14} />{COPY.hint}</p>
    </div>
  );
}

function CommentFoot({ phase, onSend }: { phase: Phase; onSend: () => void }) {
  if (phase.sent) return <Badge tone="success">{COPY.sent}</Badge>;
  if (phase.reached("translated")) return <Button size="sm" onClick={onSend}><Icon name="send" size={14} />{COPY.send}</Button>;
  if (!phase.reached("translating")) return null;
  return <span className="demo-label fdemo-status"><span className="landing-dots" aria-hidden="true"><span /><span /><span /></span>{COPY.translating}</span>;
}

// 한국어가 다 찬 높이를 처음부터 차지해 카드가 출렁이지 않게 한다
function CommentCard({ phase, onSend }: { phase: Phase; onSend: () => void }) {
  const typing = phase.reached("comment") && !phase.reached("translating");
  return (
    <div className={`demo-card fdemo-comment${phase.reached("comment") ? " is-on" : ""}`}>
      <p className="demo-label">{COPY.brandSide}</p>
      <div className="fdemo-comment-head"><span className="fdemo-no">1</span><span className="demo-mono">{COPY.cueTime}</span></div>
      <p className="fdemo-ko">
        {COPY.ko.slice(0, phase.typed)}
        {typing && <span className="demo-caret" aria-hidden="true" />}
        <span className="fdemo-pending">{COPY.ko.slice(phase.typed)}</span>
      </p>
      <p className={`fdemo-en${phase.reached("translated") ? " is-on" : ""}`}>{COPY.en}</p>
      <div className="fdemo-foot"><CommentFoot phase={phase} onSend={onSend} /></div>
    </div>
  );
}

function Versions({ compare }: { compare: boolean }) {
  return (
    <div className={`fdemo-versions${compare ? " is-compare" : ""}`}>
      {compare && (
        <div className="fdemo-thumb">
          <img src={REEL_POSTER} alt="" className="fdemo-media" />
          <MarkupBox drawn showNumber />
          <span className="fdemo-frame-tag">v1</span>
        </div>
      )}
      <div className="fdemo-thumb">
        <video src={`${REEL_VIDEO}#t=${COPY.v2Seconds}`} className="fdemo-media" muted playsInline preload="metadata" aria-hidden="true" />
        <span className="fdemo-frame-tag">v2</span>
      </div>
    </div>
  );
}

function InfluencerCard({ phase, onToggle }: { phase: Phase; onToggle: () => void }) {
  const reflected = phase.reached("reflected");
  return (
    <div className="demo-card fdemo-inf">
      <p className="demo-label">{COPY.influencerSide}</p>
      {!phase.sent && <p className="demo-label">{COPY.waiting}</p>}
      {phase.sent && (
        <div className="fdemo-inf-item">
          <span className={`fdemo-check${reflected ? " is-on" : ""}`} aria-hidden="true"><Icon name="check" size={14} /></span>
          <span className="fdemo-inf-text"><span className="demo-mono">#1 {COPY.cueTime}</span> {COPY.en}</span>
          {reflected && <Badge tone="success">{COPY.reflected}</Badge>}
        </div>
      )}
      {phase.reached("v2") && (
        <div className="fdemo-v2">
          <div className="fdemo-v2-head">
            <Badge tone="info">{COPY.v2}</Badge>
            <Button size="sm" variant="secondary" aria-pressed={phase.compare} onClick={onToggle}>{phase.compare ? COPY.compareOff : COPY.compare}</Button>
          </div>
          <Versions compare={phase.compare} />
        </div>
      )}
    </div>
  );
}

// 수정 요청: 프레임에 박스 → 한국어 코멘트 → 영어 번역 → 보내기 → 반영·v2 → 나란히 비교
export function FeedbackDemo() {
  const { sequence, phase, setCompareOverride, setManualSent } = useFeedbackPhase();
  return (
    <DemoFrame label={COPY.label} frameRef={sequence.ref} onReplay={sequence.replay} className="fdemo">
      <div className="fdemo-body">
        <BrandFrame phase={phase} onRestart={sequence.replay} />
        <div className="fdemo-side">
          <CommentCard phase={phase} onSend={() => setManualSent(true)} />
          <InfluencerCard phase={phase} onToggle={() => setCompareOverride(!phase.compare)} />
        </div>
      </div>
    </DemoFrame>
  );
}
