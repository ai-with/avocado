import { Badge, Button } from "../../../ui";
import { fmtTimecode } from "../../../../shared/review";
import { SOURCE_LABELS } from "../labels";
import type { FeedbackItem, SeekFn } from "../types";
import { FrameMarkup } from "../FrameMarkup";

export function FeedbackRow({ n, it, onSeek, onDelete }: { n: number; it: FeedbackItem; onSeek: SeekFn; onDelete?: () => void }) {
  const time = fmtTimecode(it.tMs);
  return (
    <li className="fb-item">
      <span className="fb-n">{n}</span>
      {it.frameUrl && (
        <button type="button" className="fb-frame" onClick={() => onSeek(it.tMs)} aria-label={`${time} 장면으로 이동`}>
          <FrameMarkup src={it.frameUrl} alt="" shapes={it.shape ? [it.shape] : []} />
        </button>
      )}
      <div className="stack-tight grow">
        <div className="row row-tight row-wrap">
          <button type="button" className="seg-time" onClick={() => onSeek(it.tMs)}>{time}</button>
          <Badge>{SOURCE_LABELS[it.source]}</Badge>
          {it.roundId && <Badge tone={it.influencerDone ? "success" : "neutral"}>{it.influencerDone ? "반영함" : "미반영"}</Badge>}
        </div>
        <p>{it.text}</p>
        {it.textTranslated && <p className="text-secondary"><Badge tone="info">자동 번역</Badge> {it.textTranslated}</p>}
        {it.reply && <p className="fb-reply">답글: {it.replyTranslated ?? it.reply}{it.replyTranslated && <span className="text-caption"> (원문: {it.reply})</span>}</p>}
      </div>
      {onDelete && <Button size="sm" variant="ghost" onClick={onDelete}>삭제</Button>}
    </li>
  );
}

// 보낸 회차 하나의 피드백 목록 (이번 버전, 이전 버전 공통)
export function RoundSection({ title, items, onSeek }: { title: string; items: FeedbackItem[]; onSeek: SeekFn }) {
  return (
    <section className="stack">
      <h4>{title}</h4>
      <ol className="fb-list">
        {items.map((it) => <FeedbackRow key={it.id} n={it.n ?? 0} it={it} onSeek={onSeek} />)}
      </ol>
    </section>
  );
}
