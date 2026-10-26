import { useState } from "react";
import { Badge, Button, Card, Select } from "../../../ui";
import { api } from "../../../lib/api";
import { CONFIDENCE_LABELS, DECISION_LABELS, DECISION_REASON_LABELS, RESULT_LABELS, fmtTimecode, type DecisionReason } from "../../../../shared/review";
import { RESULT_TONE, ruleLabel } from "../labels";
import type { ActFn, Candidate, Frame, ReviewDetail, SeekFn } from "../types";
import { FrameThumb } from "./FrameThumb";

type Segment = ReviewDetail["segments"][number];
type Props = { c: Candidate; base: string; canEdit: boolean; frameById: Map<string, Frame>; segById: Map<string, Segment>; onSeek: SeekFn; onAct: ActFn };
const MAX_EVIDENCE_FRAMES = 4;

export function CandidateCard({ c, base, canEdit, frameById, segById, onSeek, onAct }: Props) {
  const decide = (decision: string, r: DecisionReason | null = null) => onAct(() => api.post(`${base}/candidates/${c.id}`, { decision, reason: r }), decision === "adopted" ? "피드백 초안에 넣었어요." : undefined);
  const evidenceFrames = c.frameIds.map((id) => frameById.get(id)).filter((f): f is Frame => !!f).slice(0, MAX_EVIDENCE_FRAMES);
  const evidenceSegs = c.segmentIds.map((id) => segById.get(id)).filter((s) => !!s);
  return (
    <Card className={`stack cand cand-${c.result}`}>
      <CandidateHead c={c} />
      <p>{c.ruleContent}</p>
      <p className="text-secondary">{c.reason}</p>
      {evidenceFrames.length > 0 && (
        <div className="row row-wrap row-tight">
          {evidenceFrames.map((f) => <FrameThumb key={f.id} f={f} onClick={() => onSeek(f.tMs)} />)}
        </div>
      )}
      {evidenceSegs.map((s) => (
        <button key={s.id} type="button" className="seg-line" onClick={() => onSeek(s.startMs)}>
          <span className="seg-time">{fmtTimecode(s.startMs)}</span> {s.text}
        </button>
      ))}
      <p className="text-caption">모델 {c.modelVersion}{c.ruleVersion ? ` · 규정 v${c.ruleVersion}` : ""}</p>
      {canEdit && c.result !== "compliant" && <DecisionButtons c={c} decide={decide} />}
    </Card>
  );
}

function CandidateHead({ c }: { c: Candidate }) {
  return (
    <div className="row row-between row-wrap">
      <div className="row row-tight row-wrap">
        <Badge tone={RESULT_TONE[c.result]}>{RESULT_LABELS[c.result]}</Badge>
        <strong>{ruleLabel(c.ruleType)}</strong>
        <span className="text-caption">신뢰도 {CONFIDENCE_LABELS[c.confidence]}</span>
      </div>
      {c.decision && <Badge tone={c.decision === "adopted" ? "accent" : "neutral"}>{DECISION_LABELS[c.decision]}{c.decisionReason ? `: ${DECISION_REASON_LABELS[c.decisionReason]}` : ""}</Badge>}
    </div>
  );
}

function DecisionButtons({ c, decide }: { c: Candidate; decide: (decision: string, r?: DecisionReason | null) => Promise<void> }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<DecisionReason>("compliant");
  if (rejecting)
    return (
      <div className="row row-wrap">
        <Select aria-label="기각 사유" value={reason} onChange={(e) => setReason(e.target.value as DecisionReason)}>
          {(Object.keys(DECISION_REASON_LABELS) as DecisionReason[]).map((r) => <option key={r} value={r}>{DECISION_REASON_LABELS[r]}</option>)}
        </Select>
        <Button size="sm" variant="secondary" onClick={() => { setRejecting(false); void decide("rejected", reason); }}>기각</Button>
        <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>취소</Button>
      </div>
    );
  return (
    <div className="row">
      <Button size="sm" onClick={() => void decide("adopted")} disabled={c.decision === "adopted"}>피드백으로 채택</Button>
      <Button size="sm" variant="secondary" onClick={() => setRejecting(true)}>기각</Button>
      <Button size="sm" variant="ghost" onClick={() => void decide("held")} disabled={c.decision === "held"}>보류</Button>
    </div>
  );
}
