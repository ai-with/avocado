import { useState, type FormEvent } from "react";
import { Button, EmptyState, Input, Table } from "../../../ui";
import { api } from "../../../lib/api";
import type { Act } from "../useLeads";
import type { Lookups } from "../types";

type Props = { tags: Lookups["tags"]; onView: (tagId: string) => void; act: Act };

export function TagsTab({ tags, onView, act }: Props) {
  const [tagName, setTagName] = useState("");
  const create = (e: FormEvent) => {
    e.preventDefault();
    void act(() => api.post("/leads/tags", { name: tagName }), "태그를 만들었어요.").then(() => setTagName(""));
  };
  const remove = (t: { id: string; name: string }) => confirm(`'${t.name}' 태그를 지울까요?`) && void act(() => api.del(`/leads/tags/${t.id}`), "태그를 지웠어요.");
  return (
    <div className="stack">
      <form className="row" onSubmit={create}>
        <div className="lead-tag-input"><Input aria-label="태그 이름" placeholder="새 태그 이름" value={tagName} onChange={(e) => setTagName(e.target.value)} /></div>
        <Button type="submit" variant="secondary">태그 만들기</Button>
      </form>
      {tags.length === 0 ? (
        <EmptyState title="만든 태그가 없어요" description="연락처 탭에서 사람을 골라 태그를 붙여요." />
      ) : (
        <Table>
          <thead><tr><th>태그</th><th>붙은 사람</th><th><span className="sr-only">관리</span></th></tr></thead>
          <tbody>
            {tags.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td><Button size="sm" variant="ghost" onClick={() => onView(t.id)}>리드 보기</Button></td>
                <td className="text-right"><Button size="sm" variant="ghost" onClick={() => remove(t)}>삭제</Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
