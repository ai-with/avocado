import { useEffect, useState } from "react";
import { Button, Card, Textarea } from "../../../ui";
import { api } from "../../../lib/api";
import { fmtDateTime } from "../../guides/types";
import { fmtTimecode, type FeedbackShape } from "../../../../shared/review";
import { FrameMarkup } from "../FrameMarkup";
import type { ActFn, Frame, ReviewDetail, SeekFn } from "../types";
import { FeedbackRow, RoundSection } from "./FeedbackRow";
import { SendModal } from "./SendModal";

type Props = { d: ReviewDetail; base: string; canEdit: boolean; locked: boolean; selected: Frame | null; pickCurrent: () => void; onSeek: SeekFn; onAct: ActFn; reload: () => Promise<void> };

export function FeedbackTab({ d, base, canEdit, locked, selected, pickCurrent, onSeek, onAct, reload }: Props) {
  const [preview, setPreview] = useState(false);
  const sentHere = d.rounds.filter((r) => r.submissionId === d.submission.id);
  const flagged = new Set(d.conflicts.ids);
  return (
    <div className="stack">
      {locked && <p className="text-caption">최종 승인되어 코멘트가 잠겼어요.</p>}
      {canEdit && <NewComment d={d} base={base} selected={selected} pickCurrent={pickCurrent} onAct={onAct} />}
      {d.drafts.length === 0 ? (
        !locked && <p className="text-caption">아직 보낼 코멘트가 없어요. 위반 후보를 채택하면 여기에 초안으로 들어와요.</p>
      ) : (
        <ol className="fb-list">
          {d.drafts.map((it, i) => (
            <FeedbackRow key={it.id} n={i + 1} it={it} flagged={flagged.has(it.id)} onSeek={onSeek} onDelete={canEdit ? () => void onAct(() => api.del(`${base}/feedback/${it.id}`)) : undefined} />
          ))}
        </ol>
      )}
      {canEdit && d.drafts.length > 0 && (
        <div><Button onClick={() => setPreview(true)}>피드백 보내기 ({d.drafts.length})</Button></div>
      )}
      {sentHere.map((r) => <RoundSection key={r.id} title={`${r.n}회차 보냄 · ${fmtDateTime(r.submittedAt)}`} items={r.items} flagged={flagged} onSeek={onSeek} />)}
      <SendModal open={preview} d={d} base={base} onClose={() => setPreview(false)} onSent={reload} />
    </div>
  );
}

type NewCommentProps = { d: ReviewDetail; base: string; selected: Frame | null; pickCurrent: () => void; onAct: ActFn };

function NewComment({ d, base, selected, pickCurrent, onAct }: NewCommentProps) {
  const [tool, setTool] = useState<FeedbackShape["type"]>("box");
  const [shape, setShape] = useState<FeedbackShape | null>(null);
  const [text, setText] = useState("");
  useEffect(() => setShape(null), [selected?.id]);
  const add = () =>
    onAct(async () => {
      await api.post(`${base}/feedback`, { frameId: selected?.id ?? null, tMs: selected?.tMs ?? 0, shape, text });
      setText("");
      setShape(null);
    });
  return (
    <Card className="stack">
      <strong>새 코멘트</strong>
      {selected ? (
        <>
          <div className="row row-wrap">
            <span className="text-caption">{fmtTimecode(selected.tMs)} 장면에 표시</span>
            <Button size="sm" variant={tool === "box" ? "primary" : "secondary"} onClick={() => setTool("box")} aria-pressed={tool === "box"}>박스</Button>
            <Button size="sm" variant={tool === "arrow" ? "primary" : "secondary"} onClick={() => setTool("arrow")} aria-pressed={tool === "arrow"}>화살표</Button>
            {shape && <Button size="sm" variant="ghost" onClick={() => setShape(null)}>표시 지우기</Button>}
          </div>
          <FrameMarkup src={selected.url} alt={`${fmtTimecode(selected.tMs)} 프레임`} shapes={shape ? [shape] : []} tool={tool} onDraw={setShape} />
        </>
      ) : (
        <div className="row row-wrap">
          <p className="text-caption">왼쪽에서 프레임을 고르거나 영상을 멈춘 뒤 현재 장면을 가져오세요.</p>
          <Button size="sm" variant="secondary" onClick={pickCurrent} disabled={d.frames.length === 0}>현재 장면 가져오기</Button>
        </div>
      )}
      <Textarea label="코멘트 (한국어)" value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 제품 라벨이 잘 보이게 다시 찍어 주세요" />
      <div><Button size="sm" onClick={() => void add()} disabled={!text.trim()}>코멘트 추가</Button></div>
    </Card>
  );
}
