import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, EmptyState, Input, LoadingState, Modal, PageHeader, Select, Table, useToast } from "../../ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import { countryOptions } from "../../lib/countries";
import type { Influencer } from "./types";

export type InfluencerDraft = { displayName: string; igHandle: string; threadsHandle: string; email: string; lang: "ko" | "en"; country: string };
export const emptyDraft = (): InfluencerDraft => ({ displayName: "", igHandle: "", threadsHandle: "", email: "", lang: "ko", country: "KR" });
export const handlesText = (i: Influencer) => [i.igHandle && `@${i.igHandle}`, i.threadsHandle && `스레드 @${i.threadsHandle}`].filter(Boolean).join(" · ");
export const langLabel = (lang: Influencer["lang"]) => (lang === "en" ? "영어" : "한국어");
const toDraft = (r: Influencer): InfluencerDraft => ({ displayName: r.displayName, igHandle: r.igHandle ?? "", threadsHandle: r.threadsHandle ?? "", email: r.email ?? "", lang: r.lang, country: r.country ?? "" });

export function InfluencerFields({ draft, onChange, fields }: { draft: InfluencerDraft; onChange: (d: InfluencerDraft) => void; fields: Record<string, string> }) {
  const set = (k: keyof InfluencerDraft, v: string) => onChange({ ...draft, [k]: v });
  return (
    <>
      <Input label="이름" value={draft.displayName} onChange={(e) => set("displayName", e.target.value)} error={fields.displayName} required />
      <div className="grid-2">
        <Input label="인스타그램" value={draft.igHandle} onChange={(e) => set("igHandle", e.target.value)} placeholder="@handle" />
        <Input label="스레드" value={draft.threadsHandle} onChange={(e) => set("threadsHandle", e.target.value)} placeholder="@handle" />
      </div>
      <Input label="이메일 (선택)" type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} error={fields.email} />
      <div className="grid-2">
        <Select label="언어" value={draft.lang} onChange={(e) => set("lang", e.target.value)}>
          <option value="ko">한국어</option>
          <option value="en">영어</option>
        </Select>
        <Select label="국가" value={draft.country} onChange={(e) => set("country", e.target.value)}>
          {countryOptions("ko").map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </Select>
      </div>
    </>
  );
}

export const influencerBody = (d: InfluencerDraft) => ({ ...d, igHandle: d.igHandle || null, threadsHandle: d.threadsHandle || null, email: d.email || null, country: d.country || null });

type Editing = { id: string | null; draft: InfluencerDraft };

function useInfluencers() {
  const toast = useToast();
  const [rows, setRows] = useState<Influencer[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const load = useCallback(async () => setRows((await api.get<{ influencers: Influencer[] }>("/influencers")).influencers), []);
  useEffect(() => void load(), [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      if (editing.id) await api.patch(`/influencers/${editing.id}`, influencerBody(editing.draft));
      else await api.post("/influencers", influencerBody(editing.draft));
      setEditing(null);
      setFields({});
      await load();
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      toast(errorMessage(err), "danger");
    }
  };
  const remove = (r: Influencer) => confirm(`${r.displayName}님을 지울까요? 연결된 가이드 링크도 함께 지워져요.`) && void api.del(`/influencers/${r.id}`).then(load);
  return { rows, editing, setEditing, fields, save, remove };
}

function InfluencerRow({ r, canEdit, onEdit, onRemove }: { r: Influencer; canEdit: boolean; onEdit: () => void; onRemove: () => void }) {
  return (
    <tr>
      <td className="nowrap">{r.displayName}</td>
      <td>{handlesText(r)}</td>
      <td>{r.email}</td>
      <td className="nowrap">{langLabel(r.lang)}</td>
      <td className="nowrap">{r.country}</td>
      <td className="num">{r.guideCount ?? 0}</td>
      {canEdit && (
        <td className="text-right">
          <div className="row row-end">
            <Button size="sm" variant="ghost" onClick={onEdit}>수정</Button>
            <Button size="sm" variant="ghost" onClick={onRemove}>삭제</Button>
          </div>
        </td>
      )}
    </tr>
  );
}

function InfluencerTable({ rows, canEdit, onEdit, onRemove }: { rows: Influencer[]; canEdit: boolean; onEdit: (r: Influencer) => void; onRemove: (r: Influencer) => void }) {
  return (
    <Table>
      <thead>
        <tr><th>이름</th><th>인스타·스레드</th><th>이메일</th><th>언어</th><th>국가</th><th className="num">참여 가이드</th>{canEdit && <th><span className="sr-only">관리</span></th>}</tr>
      </thead>
      <tbody>
        {rows.map((r) => <InfluencerRow key={r.id} r={r} canEdit={canEdit} onEdit={() => onEdit(r)} onRemove={() => onRemove(r)} />)}
      </tbody>
    </Table>
  );
}

// /influencers: 워크스페이스 인플루언서 (가이드마다 다시 쓴다)
export function InfluencersPage() {
  const { me } = useMe();
  const canEdit = me?.role === "owner" || me?.role === "editor";
  const { rows, editing, setEditing, fields, save, remove } = useInfluencers();
  const add = <Button onClick={() => setEditing({ id: null, draft: emptyDraft() })}>인플루언서 추가</Button>;

  return (
    <>
      <PageHeader title="인플루언서" description="한 번 등록하면 여러 가이드에서 다시 쓸 수 있어요." actions={canEdit && add} />
      {rows === null ? <LoadingState /> : rows.length === 0 ? (
        <EmptyState title="등록한 인플루언서가 없어요" description="가이드 상세에서 바로 추가해도 여기에 쌓여요." action={canEdit && add} />
      ) : (
        <InfluencerTable rows={rows} canEdit={canEdit} onEdit={(r) => setEditing({ id: r.id, draft: toDraft(r) })} onRemove={remove} />
      )}
      <Modal open={editing !== null} title={editing?.id ? "인플루언서 수정" : "인플루언서 추가"} onClose={() => setEditing(null)}>
        {editing && (
          <form className="stack" onSubmit={save}>
            <InfluencerFields draft={editing.draft} onChange={(draft) => setEditing({ ...editing, draft })} fields={fields} />
            <div className="row row-end">
              <Button variant="ghost" onClick={() => setEditing(null)}>취소</Button>
              <Button type="submit">저장</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
