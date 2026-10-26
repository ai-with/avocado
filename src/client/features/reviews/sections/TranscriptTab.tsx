import { useState } from "react";
import { Badge, Button, Card, Checkbox, EmptyState } from "../../../ui";
import { api } from "../../../lib/api";
import { fmtTimecode } from "../../../../shared/review";
import type { ActFn, ReviewDetail, SeekFn } from "../types";

export function TranscriptTab({ d, base, canEdit, onSeek, onAct }: { d: ReviewDetail; base: string; canEdit: boolean; onSeek: SeekFn; onAct: ActFn }) {
  const [translated, setTranslated] = useState(false);
  const stt = d.jobs.find((j) => j.stage === "transcribe");
  const tr = d.jobs.find((j) => j.stage === "translate");
  if (stt?.status === "failed")
    return (
      <Card className="stack">
        <strong>전사 실패</strong>
        <p className="text-secondary">음성을 텍스트로 바꾸지 못했어요. 영상과 프레임은 그대로 볼 수 있어요.</p>
        {canEdit && <div><Button variant="secondary" onClick={() => void onAct(() => api.post(`${base}/retry`, { stage: "transcribe" }), "다시 요청했어요.")}>전사 다시 요청</Button></div>}
      </Card>
    );
  if (stt?.status === "skipped") return <EmptyState title="음성 없음" description="대사가 없는 영상이에요. 위반 후보는 화면 기준으로만 찾았어요." />;
  if (d.segments.length === 0) return <EmptyState title="전사 준비 중" description="처리가 끝나면 타임코드가 붙은 대사가 보여요." />;
  return (
    <div className="stack">
      <div className="row">
        <Checkbox label="번역 보기" checked={translated} onChange={(e) => setTranslated(e.target.checked)} />
        {translated && <Badge tone="info">자동 번역</Badge>}
        {tr?.status === "failed" && <span className="text-caption">번역 실패, 원문만 보여요</span>}
      </div>
      <ol className="seg-list">
        {d.segments.map((s) => (
          <li key={s.id}>
            <button type="button" className="seg-line" onClick={() => onSeek(s.startMs)}>
              <span className="seg-time">{fmtTimecode(s.startMs)}</span> {translated && s.translatedText ? s.translatedText : s.text}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
