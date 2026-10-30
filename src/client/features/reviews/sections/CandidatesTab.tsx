import { useState } from "react";
import { Button, Card, EmptyState, Textarea, SelectMenu } from "../../../ui";
import { api } from "../../../lib/api";
import { fmtTimecode } from "../../../../shared/review";
import { RESULT_ORDER, ruleLabel } from "../labels";
import type { ActFn, Frame, ReviewDetail, SeekFn } from "../types";
import { CandidateCard } from "./CandidateCard";

type Props = { d: ReviewDetail; base: string; canEdit: boolean; processing: boolean; selected: Frame | null; onSeek: SeekFn; onAct: ActFn };

export function CandidatesTab({ d, base, canEdit, processing, selected, onSeek, onAct }: Props) {
  const [missed, setMissed] = useState(false);
  const detectFailed = d.jobs.find((j) => j.stage === "detect")?.status === "failed";
  if (detectFailed) return <DetectFailed canEdit={canEdit} onRetry={() => void onAct(() => api.post(`${base}/retry`, { stage: "detect" }), "다시 분석을 요청했어요.")} />;
  if (processing && d.candidates.length === 0) return <EmptyState title="처리 중이에요" description="음성 전사와 위반 후보 탐지가 끝나면 여기에 보여요. 보통 5분 안에 끝나요." />;
  const frameById = new Map(d.frames.map((f) => [f.id, f]));
  const segById = new Map(d.segments.map((s) => [s.id, s]));
  const flagged = new Set(d.conflicts.ids);
  const sorted = [...d.candidates].sort((a, b) => RESULT_ORDER.indexOf(a.result) - RESULT_ORDER.indexOf(b.result));
  return (
    <div className="stack">
      <p className="text-caption">위반 후보는 모델이 찾은 참고 목록이에요. 채택한 것만 피드백 초안이 되고, 인플루언서에게는 '피드백 보내기'를 눌러야 전달돼요.</p>
      {canEdit && (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setMissed(!missed)} aria-expanded={missed}>놓친 위반 추가</Button>
        </div>
      )}
      {missed && <MissedForm d={d} base={base} selected={selected} onDone={() => setMissed(false)} onAct={onAct} />}
      {sorted.length === 0 && <EmptyState title="검사한 규칙이 없어요" description="가이드에 켜진 규칙이 없으면 위반 후보를 만들지 않아요." />}
      {sorted.map((c) => (
        <CandidateCard key={c.id} c={c} base={base} canEdit={canEdit} flagged={flagged.has(c.id)} frameById={frameById} segById={segById} onSeek={onSeek} onAct={onAct} />
      ))}
    </div>
  );
}

function DetectFailed({ canEdit, onRetry }: { canEdit: boolean; onRetry: () => void }) {
  return (
    <Card className="stack">
      <strong>자동 분석 불가</strong>
      <p className="text-secondary">위반 후보를 만들지 못했어요. 프레임을 골라 피드백을 직접 남길 수 있어요.</p>
      {canEdit && <div><Button variant="secondary" onClick={onRetry}>다시 분석</Button></div>}
    </Card>
  );
}

function MissedForm({ d, base, selected, onDone, onAct }: { d: ReviewDetail; base: string; selected: Frame | null; onDone: () => void; onAct: ActFn }) {
  const [ruleId, setRuleId] = useState(d.rules[0]?.id ?? "");
  const [text, setText] = useState("");
  const submit = () =>
    onAct(async () => {
      await api.post(`${base}/missed`, { ruleId, frameId: selected?.id ?? null, tMs: selected?.tMs ?? 0, shape: null, text });
      onDone();
    }, "놓친 위반을 피드백에 넣었어요.");
  return (
    <Card className="stack">
      <SelectMenu label="규칙" options={d.rules.map((r) => ({ value: r.id, label: r.content, description: ruleLabel(r.type) }))} value={ruleId || null} onChange={(v) => v && setRuleId(v)} />
      <p className="text-caption">{selected ? `선택한 프레임 ${fmtTimecode(selected.tMs)}` : "왼쪽 프레임 목록에서 장면을 먼저 골라 주세요."}</p>
      <Textarea label="코멘트" value={text} onChange={(e) => setText(e.target.value)} placeholder="무엇을 고쳐야 하는지 적어 주세요" />
      <div className="row">
        <Button size="sm" onClick={() => void submit()} disabled={!ruleId || !text.trim() || !selected}>놓친 위반 추가</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>취소</Button>
      </div>
    </Card>
  );
}
