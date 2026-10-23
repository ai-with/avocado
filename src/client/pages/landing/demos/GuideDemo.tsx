import { Badge, Button, Icon } from "../../../ui";
import { DEMO_COPY, INFLUENCERS } from "./demoCopy";
import { DemoFrame } from "./DemoFrame";
import { stepsFromGaps, useDemoSequence } from "./useDemoSequence";
import "./guide.css";

const COPY = DEMO_COPY.guide;
const START_MS = 400;
const TYPE_MS = 28;
// URL 타이핑 뒤 단계: 가져오기 → 칸 3개 → 초안 만들기 → 장면 4개 → 링크 칩 → 열람
const PHASE_GAPS = [350, 600, 350, 350, 700, 600, 450, 450, 450, 700, 900] as const;
const P = { fetch: 0, field: 1, draft: 4, scene: 5, links: 9, opened: 10 } as const;
const TYPED_STEPS = COPY.url.length;
const STEPS = stepsFromGaps([START_MS, ...Array<number>(TYPED_STEPS - 1).fill(TYPE_MS), ...PHASE_GAPS]);
const OPENED_INDEX = 1;

function UrlRow({ typed, pressed, onFetch }: { typed: number; pressed: boolean; onFetch: () => void }) {
  const typing = typed > 0 && typed < TYPED_STEPS;
  return (
    <div className="guide-url">
      <span className="guide-url-field demo-mono" aria-label="상품 URL">
        {COPY.url.slice(0, typed)}{typing && <span className="demo-caret" />}
      </span>
      <Button size="sm" className={pressed ? "is-pressed" : ""} onClick={onFetch}>{COPY.fetch}</Button>
    </div>
  );
}

export function GuideDemo() {
  const { step, replay, ref } = useDemoSequence(STEPS);
  const typed = Math.max(0, Math.min(step + 1, TYPED_STEPS));
  const reached = (phase: number) => step >= TYPED_STEPS + phase;
  const shown = (phase: number) => `demo-reveal ${reached(phase) ? "is-shown" : ""}`;
  const pressedAt = (phase: number) => reached(phase) && !reached(phase + 1);

  return (
    <DemoFrame label={COPY.label} frameRef={ref} onReplay={replay}>
      <UrlRow typed={typed} pressed={pressedAt(P.fetch)} onFetch={replay} />
      <div className="demo-card guide-fields">
        {COPY.fields.map((f, i) => (
          <div key={f.label} className="guide-field">
            <span className="guide-field-label">{f.label}</span>
            <span className={shown(P.field + i)}>{f.value}</span>
          </div>
        ))}
        <Button size="sm" variant="secondary" className={`guide-draft ${pressedAt(P.draft) ? "is-pressed" : ""}`} onClick={replay}>
          {COPY.draft}
        </Button>
      </div>
      <ol className="guide-scenes">
        {COPY.scenes.map((s, i) => (
          <li key={s.title} className={`demo-card guide-scene ${shown(P.scene + i)}`}>
            <span className="demo-mono">{s.time} · {s.title}</span>
            <span>{s.line}</span>
          </li>
        ))}
      </ol>
      <div className={`guide-links ${shown(P.links)}`}>
        <span className="demo-card-title">{COPY.linksTitle}</span>
        <ul className="guide-link-chips">
          {INFLUENCERS.map((name, i) => (
            <li key={name} className="guide-link-chip">
              <Icon name="link" size={14} />{name}
              {i === OPENED_INDEX && reached(P.opened) && <Badge tone="success">{COPY.opened}</Badge>}
            </li>
          ))}
        </ul>
      </div>
    </DemoFrame>
  );
}
