import { Badge } from "../../../ui";
import { channelLabel, SOURCE_TYPE_LABELS } from "../../../../shared/leads";
import { dateTime, seconds } from "../../links/common";
import { nameOf, type LeadDetail, type Lookups } from "../types";

export function LeadTags({ tagIds, lk, onRemove }: { tagIds: string[]; lk: Lookups; onRemove: (tagId: string) => void }) {
  return (
    <div className="lt-chips">
      {tagIds.map((t) => {
        const name = nameOf(lk.tags, t);
        return (
          <Badge key={t}>
            {name}
            <button type="button" className="lead-tag-remove" aria-label={`${name} 태그 빼기`} title={`${name} 태그 빼기`} onClick={() => onRemove(t)}>×</button>
          </Badge>
        );
      })}
    </div>
  );
}

export function SourceList({ sources, lk }: { sources: LeadDetail["sources"]; lk: Lookups }) {
  return (
    <section className="stack-tight">
      <h4>출처</h4>
      {sources.map((s, i) => (
        <div key={i} className="text-secondary">
          {dateTime(s.at)} · {SOURCE_TYPE_LABELS[s.type]}
          {s.guideId && ` · ${nameOf(lk.guides, s.guideId)}`}
          {s.linkId && ` · ${nameOf(lk.influencers, s.influencerId) || "가이드 공용"}`}
          {s.channelKey && ` · ${channelLabel(s.channelKey, lk.channels)}`}
        </div>
      ))}
    </section>
  );
}

export function ViewList({ views }: { views: LeadDetail["views"] }) {
  return (
    <section className="stack-tight">
      <h4>자료 열람</h4>
      {views.length === 0 && <p className="text-secondary">아직 열람 기록이 없어요. 자료 링크를 열면 페이지별 머문 시간이 쌓여요.</p>}
      {views.map((v) => (
        <div key={v.id}>
          <b>{v.title}</b> <span className="text-caption">{dateTime(v.startedAt)} · {v.maxPage}/{v.pages}페이지{v.completed ? " · 완독" : ""}</span>
          {v.pageDwell.length > 0 && <div className="text-caption">{v.pageDwell.map((p) => `${p.page}p ${seconds(p.dwellMs)}`).join(", ")}</div>}
        </div>
      ))}
    </section>
  );
}

type AnswerProps = { submissions: LeadDetail["submissions"]; answers: LeadDetail["lead"]["answers"] };

// 폼 제출 기록이 없을 때만 리드에 남은 예전 답변(answers)을 보여 준다
export function AnswerList({ submissions, answers }: AnswerProps) {
  const legacy = submissions.length === 0 ? Object.entries(answers) : [];
  return (
    <section className="stack-tight">
      <h4>제출 답변</h4>
      {submissions.length === 0 && legacy.length === 0 && <p className="text-secondary">제출한 답변이 없어요.</p>}
      {submissions.map((s) => (
        <div key={s.id}>
          <b>{s.formTitle}</b> <span className="text-caption">{dateTime(s.at)}</span>
          {s.questions.map((q) => s.answers[q.id] !== undefined && <div key={q.id} className="text-secondary">{q.label}: {[s.answers[q.id]].flat().join(", ")}</div>)}
        </div>
      ))}
      {legacy.map(([k, v]) => <div key={k} className="text-secondary">{k}: {[v].flat().join(", ")}</div>)}
    </section>
  );
}
