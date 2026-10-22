import { Button, EmptyState, Table } from "../../../ui";
import { api } from "../../../lib/api";
import { describe } from "../groupRules";
import type { Act, Group } from "../useLeads";
import type { Lookups } from "../types";

type Props = { groups: Group[]; lk: Lookups; onNew: () => void; onEdit: (g: Group) => void; onView: (groupId: string) => void; act: Act };

export function GroupsTab({ groups, lk, onNew, onEdit, onView, act }: Props) {
  const remove = (g: Group) => confirm(`'${g.name}' 그룹을 지울까요? 리드는 그대로 남아요.`) && void act(() => api.del(`/leads/groups/${g.id}`), "그룹을 지웠어요.");
  return (
    <div className="stack">
      <p className="text-secondary">그룹은 조건을 만족하는 사람이에요. 조건이 바뀌면 자동으로 들고 나요. 태그는 사람이 붙인 메모라 조건과 무관하게 남아요.</p>
      <div><Button onClick={onNew}>그룹 만들기</Button></div>
      {groups.length === 0 ? (
        <EmptyState title="만든 그룹이 없어요" description="예: '인플루언서 A 유입 + 마케팅 동의'처럼 조건으로 묶어 후속 발송에 써요." />
      ) : (
        <Table>
          <thead><tr><th>이름</th><th>조건</th><th className="num">현재 인원</th><th><span className="sr-only">관리</span></th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td className="text-secondary wrap">{g.rules.all.map((c) => describe(c, lk)).join(" 그리고 ") || "전체"}</td>
                <td className="num">{g.count}</td>
                <td className="text-right">
                  <div className="row row-end">
                    <Button size="sm" variant="secondary" onClick={() => onView(g.id)}>리드 보기</Button>
                    <Button size="sm" variant="ghost" onClick={() => onEdit(g)}>수정</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(g)}>삭제</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
