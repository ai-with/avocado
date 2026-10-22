import { Button, EmptyState, SectionCard, Table } from "../../../ui";
import { dateTime, ZERO_HINT, type LinkRow } from "../../links/common";
import { VisitorForm } from "../VisitorForm";
import type { Draft, Submission } from "../form-model";

export function LinksSection({ links, onMakeLink }: { links: LinkRow[]; onMakeLink: () => void }) {
  return (
    <SectionCard title="링크" actions={<Button size="sm" variant="secondary" onClick={onMakeLink}>공용 링크 만들기</Button>}>
      {links.length === 0 ? (
        <p className="text-secondary">가이드의 '리드 링크' 탭에서 이 폼을 목적지로 고르면 인플루언서별 링크가 생겨요. 바로 쓸 공용 링크도 만들 수 있어요.</p>
      ) : (
        links.map((l) => <div key={l.id} className="mono">{l.url} · {l.influencerName ?? "공용"} · 클릭 {l.stats.clicks}</div>)
      )}
    </SectionCard>
  );
}

export function SubmissionsSection({ d, subs }: { d: Draft; subs: Submission[] }) {
  return (
    <section className="stack">
      <h4>제출 {subs.length}건</h4>
      {subs.length === 0 ? (
        <EmptyState title="아직 제출이 없어요" description={ZERO_HINT} />
      ) : (
        <Table>
          <thead><tr><th>제출 시각</th><th>이메일</th><th>이름</th>{d.fields.questions.map((q) => <th key={q.id}>{q.label}</th>)}</tr></thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s.id}>
                <td className="nowrap">{dateTime(s.at)}</td><td>{s.email}</td><td>{s.name}</td>
                {d.fields.questions.map((q) => <td key={q.id} className="wrap">{[s.answers[q.id] ?? ""].flat().join(", ")}</td>)}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

// 오른쪽 방문자 화면 실시간 미리보기
export function PreviewPane({ d, brand }: { d: Draft; brand: string }) {
  return (
    <aside className="stack form-preview-pane" aria-label="방문자 화면 미리보기">
      <span className="text-caption">방문자 화면 미리보기</span>
      <div className="visitor form-preview">
        <VisitorForm
          key={JSON.stringify(d.fields.base)}
          preview
          brandName={brand}
          title={d.title || "제목을 넣어 주세요"}
          description={d.description}
          headerImageUrl={d.headerImageKey ? `/api/public/asset/${d.headerImageKey}` : null}
          base={d.fields.base.filter((b) => b.enabled)}
          questions={d.fields.questions.filter((q) => q.label)}
          submitLabel="제출하기"
        />
      </div>
    </aside>
  );
}
