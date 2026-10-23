import { useState } from "react";
import { Badge, Button, Icon, type BadgeTone } from "../../../ui";
import { DEMO_COPY, INFLUENCERS, REEL_SRC } from "./demoCopy";
import { DemoFrame } from "./DemoFrame";
import { stepsFromGaps, useDemoSequence } from "./useDemoSequence";
import "./upload.css";

const COPY = DEMO_COPY.upload;
// 참여하기 → 동의 → 영상 선택 → 업로드 시작 → 업로드 완료(처리 중) → 검수 대기
const STEPS = stepsFromGaps([500, 800, 800, 600, 1800, 1300]);
const P = { join: 0, consent: 1, pick: 2, uploading: 3, uploaded: 4, review: 5 } as const;

type Status = keyof typeof COPY.status;
const STATUS_TONE: Record<Status, BadgeTone> = { waiting: "neutral", uploading: "info", processing: "warn", review: "accent" };
// B는 이미 올렸고 C는 아직이다. A가 이번 시퀀스에서 올리는 사람
const OTHER_ROWS: Status[] = ["review", "waiting"];

function liveStatus(step: number): Status {
  if (step >= P.review) return "review";
  if (step >= P.uploaded) return "processing";
  if (step >= P.uploading) return "uploading";
  return "waiting";
}

function Phone({ step, onJoin }: { step: number; onJoin: () => void }) {
  const at = (phase: number) => step >= phase;
  return (
    <div className="upload-phone" aria-label="인플루언서 휴대폰 화면">
      <span className="upload-phone-notch" />
      <strong>{COPY.phoneTitle}</strong>
      <Button size="sm" className={step === P.join ? "is-pressed" : ""} onClick={onJoin}>{COPY.join}</Button>
      <div className={`upload-consent demo-reveal ${at(P.join) ? "is-shown" : ""}`}>
        <span className={`upload-check ${at(P.consent) ? "is-on" : ""}`}>{at(P.consent) && <Icon name="check" size={12} />}</span>
        {COPY.consent}
      </div>
      <div className={`upload-pick demo-reveal ${at(P.consent) ? "is-shown" : ""}`}>
        <Button size="sm" variant="secondary" className={step === P.pick ? "is-pressed" : ""} onClick={onJoin}>{COPY.pick}</Button>
        {at(P.pick) && <span className="demo-mono">{COPY.file}</span>}
      </div>
      <div className={`upload-progress demo-reveal ${at(P.uploading) ? "is-shown" : ""}`}>
        <div className="upload-track"><div className={`upload-bar ${at(P.uploading) ? "is-full" : ""}`} /></div>
        <span className="demo-mono">{at(P.uploaded) ? COPY.uploaded : COPY.uploading}</span>
      </div>
    </div>
  );
}

function Preview({ row, hasVideo }: { row: number | null; hasVideo: boolean }) {
  if (row === null) return <p className="upload-preview-hint">{COPY.previewHint}</p>;
  if (!hasVideo) return <p className="upload-preview-hint">{COPY.noVideo}</p>;
  return (
    <figure className="upload-preview">
      <img src={`${REEL_SRC}.jpg`} alt={`${INFLUENCERS[row]} 제출 영상 첫 장면`} />
      <figcaption className="demo-mono">{INFLUENCERS[row]} · v1</figcaption>
    </figure>
  );
}

export function UploadDemo() {
  const { step, replay, ref } = useDemoSequence(STEPS);
  const [picked, setPicked] = useState<number | null>(null);
  const statuses: Status[] = [liveStatus(step), ...OTHER_ROWS];
  const selected = picked ?? (step >= P.review ? 0 : null);
  const restart = () => { setPicked(null); replay(); };
  const hasVideo = (row: number) => statuses[row] === "processing" || statuses[row] === "review";

  return (
    <DemoFrame label={COPY.label} frameRef={ref} onReplay={restart} className="upload-demo">
      <div className="upload-layout">
        <Phone step={step} onJoin={restart} />
        <div className="demo-card upload-inbox">
          <span className="demo-card-title">{COPY.inboxTitle}</span>
          <ul className="upload-rows">
            {INFLUENCERS.map((name, i) => (
              <li key={name}>
                <button type="button" className={`upload-row ${selected === i ? "is-selected" : ""}`}
                  aria-pressed={selected === i} onClick={() => setPicked(i)}>
                  <span>{name}</span>
                  <Badge tone={STATUS_TONE[statuses[i] ?? "waiting"]}>{COPY.status[statuses[i] ?? "waiting"]}</Badge>
                </button>
              </li>
            ))}
          </ul>
          <Preview row={selected} hasVideo={selected !== null && hasVideo(selected)} />
        </div>
      </div>
    </DemoFrame>
  );
}
