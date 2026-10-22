import { Table } from "../../../ui";
import { dateTime } from "../common";

type LeadView = { leadId: string; email: string; name: string | null; maxPage: number; completed: boolean; startedAt: number };

// 게이트로 신원이 붙은 열람만. 나머지 열람은 익명이라 여기 없다
export function LeadViewsTable({ leadViews, pages }: { leadViews: LeadView[]; pages: number }) {
  return (
    <section className="stack">
      <h4>리드와 연결된 열람</h4>
      {leadViews.length === 0 ? (
        <p className="text-secondary">게이트를 켜면 누가 어디까지 읽었는지 이름이 붙어요. 나머지 열람은 익명이에요.</p>
      ) : (
        <Table>
          <thead><tr><th>리드</th><th className="num">읽은 페이지</th><th>완독</th><th>열람 시각</th></tr></thead>
          <tbody>
            {leadViews.map((v, i) => (
              <tr key={i}>
                <td className="wrap">{v.name ? `${v.name} · ` : ""}{v.email}</td>
                <td className="num">{v.maxPage} / {pages}</td>
                <td>{v.completed ? "완독" : ""}</td>
                <td className="nowrap">{dateTime(v.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
