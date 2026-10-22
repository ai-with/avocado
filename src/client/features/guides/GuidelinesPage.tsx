import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, Button, EmptyState, Input, PageHeader, SectionCard, useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import { RuleEditor, type RuleInput } from "./RuleEditor";
import type { RuleSet, RuleSetDetail } from "./types";
import "./guides.css";

function useGuidelineSets() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [sets, setSets] = useState<RuleSet[]>([]);
  const [detail, setDetail] = useState<RuleSetDetail | null>(null);
  const selected = params.get("set") ?? sets[0]?.id ?? null;

  const loadSets = useCallback(async () => setSets((await api.get<{ sets: RuleSet[] }>("/guideline-sets")).sets), []);
  useEffect(() => void loadSets(), [loadSets]);
  useEffect(() => {
    if (selected) void api.get<RuleSetDetail>(`/guideline-sets/${selected}`).then(setDetail);
    else setDetail(null);
  }, [selected]);

  const run = async (fn: () => Promise<RuleSetDetail>) => {
    try {
      setDetail(await fn());
      await loadSets();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  const create = async (name: string) => {
    const d = await api.post<RuleSetDetail>("/guideline-sets", { name });
    await loadSets();
    setParams({ set: d.set!.id });
  };
  const base = `/guideline-sets/${selected}`;
  const removeSet = () => void api.del(base).then(() => { setParams({}); return loadSets(); });
  return { sets, detail, selected, base, select: (id: string) => setParams({ set: id }), run, create, removeSet };
}

function NewSetForm({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const toast = useToast();
  const [newName, setNewName] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await onCreate(newName);
      setNewName("");
    } catch (err) {
      toast(errorMessage(err), "danger");
    }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <Input label="새 규정 세트" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="예: 기본 규정" required />
      <Button type="submit" variant="secondary">규정 세트 만들기</Button>
    </form>
  );
}

type SetDetailProps = { base: string; detail: RuleSetDetail; canEdit: boolean; run: (fn: () => Promise<RuleSetDetail>) => Promise<void>; onDelete: () => void };

function SetDetail({ base, detail, canEdit, run, onDelete }: SetDetailProps) {
  const confirmDelete = () => confirm("규정 세트를 지울까요? 이 세트를 쓰던 가이드는 세트 없이 남습니다.") && onDelete();
  const actions = (
    <>
      <Badge>버전 {detail.set.version}</Badge>
      {canEdit && <Button size="sm" variant="ghost" onClick={confirmDelete}>세트 삭제</Button>}
    </>
  );
  return (
    <SectionCard title={detail.set.name} actions={actions}>
      <div className="stack">
        <Warnings items={detail.warnings} />
        <RuleEditor
          readOnly={!canEdit}
          rules={detail.rules}
          onAdd={(r: RuleInput) => run(() => api.post(`${base}/rules`, r))}
          onUpdate={(id, patch) => run(() => api.patch(`${base}/rules/${id}`, patch))}
          onDelete={(id) => run(() => api.del(`${base}/rules/${id}`))}
        />
        <p className="text-caption">규칙을 바꾸면 버전이 올라가고, 이미 보낸 가이드 링크에도 최신 규칙이 보여요.</p>
      </div>
    </SectionCard>
  );
}

// /settings/guidelines: 규정 세트 관리 (F-55). 가이드 편집 화면의 링크로 들어온다
export function GuidelinesPage() {
  const { me } = useMe();
  const canEdit = me?.role === "owner" || me?.role === "editor";
  const g = useGuidelineSets();
  return (
    <>
      <PageHeader title="규정 세트" description="브랜드의 필수·금지 사항을 규칙으로 저장해 두면 가이드마다 다시 쓰고, 영상 검수에도 그대로 씁니다." />
      <div className="split">
        <aside className="stack">
          {g.sets.map((s) => (
            <button key={s.id} type="button" className={`set-item ${s.id === g.selected ? "is-active" : ""}`} aria-current={s.id === g.selected} onClick={() => g.select(s.id)}>
              <span>{s.name}</span>
              <span className="text-caption">규칙 {s.ruleCount}개 · v{s.version}</span>
            </button>
          ))}
          {canEdit && <NewSetForm onCreate={g.create} />}
        </aside>
        <section>
          {!g.detail?.set ? (
            <EmptyState title="규정 세트가 없어요" description="왼쪽에서 세트를 만들면 광고 표기 규칙(음성과 화면 텍스트)이 기본으로 들어가요." />
          ) : (
            <SetDetail base={g.base} detail={g.detail} canEdit={canEdit} run={g.run} onDelete={g.removeSet} />
          )}
        </section>
      </div>
    </>
  );
}

export function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="warn-box" role="status">
      {items.map((w) => <p key={w}>{w}</p>)}
    </div>
  );
}
