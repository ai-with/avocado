import { Badge, Button, EmptyState, Switch, Table, useToast } from "../../../ui";
import { api, errorMessage } from "../../../lib/api";
import { TERM_KIND_LABELS, type BrandTerm, type TermKind } from "../../../../shared/brand-terms";
import { RULE_TARGET_LABELS, SEVERITY_LABELS } from "../../../../shared/guides";
import { termsPath } from "../api";

type Props = { brandId: string; kind: TermKind; terms: BrandTerm[]; canEdit: boolean; onAdd: () => void; onEdit: (t: BrandTerm) => void; reload: () => Promise<void> };

const EMPTY_HINT: Record<TermKind, string> = {
  required_ment: "영상에서 꼭 말해야 하는 멘트를 넣으면 모든 캠페인 검수에서 확인해요.",
  forbidden: "쓰면 안 되는 말과 변형어를 넣으면 대사에서 찾아 위반 후보로 올려요.",
  hashtag: "#광고처럼 꼭 넣어야 하는 해시태그를 넣어요.",
  product_name: "바른 제품명과 자주 틀리는 표기를 넣으면 오표기를 찾아요.",
};

function detail(t: BrandTerm) {
  if (t.kind === "required_ment") return t.match === "exact" ? "그대로 말하기" : "비슷한 말 허용";
  if (t.kind === "product_name") return t.variants.length ? `오표기: ${t.variants.join(", ")}` : "";
  if (t.kind === "forbidden") return [t.variants.length ? `변형어: ${t.variants.join(", ")}` : "", t.suggestion ? `대체: ${t.suggestion}` : ""].filter(Boolean).join(" · ");
  return "";
}

function useTermActions(brandId: string, reload: () => Promise<void>) {
  const toast = useToast();
  const run = async (task: () => Promise<unknown>) => {
    try {
      await task();
      await reload();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  const toggle = (t: BrandTerm, enabled: boolean) => run(() => api.patch(`${termsPath(brandId)}/${t.id}`, { enabled }));
  const remove = (t: BrandTerm) => {
    if (confirm(`'${t.term}' 항목을 지울까요?`)) void run(() => api.del(`${termsPath(brandId)}/${t.id}`));
  };
  return { toggle, remove };
}

// 사전 한 종류의 항목 표 (필수 멘트, 금지어, 해시태그, 제품명)
export function TermsTab({ brandId, kind, terms, canEdit, onAdd, onEdit, reload }: Props) {
  const { toggle, remove } = useTermActions(brandId, reload);
  const label = TERM_KIND_LABELS[kind];
  const add = canEdit && <Button onClick={onAdd}>{label} 추가</Button>;
  if (!terms.length) return <EmptyState compact title={`아직 ${label} 항목이 없어요`} description={EMPTY_HINT[kind]} action={add} />;
  return (
    <div className="stack">
      {canEdit && <div className="row row-end"><Button size="sm" variant="secondary" onClick={onAdd}>{label} 추가</Button></div>}
      <Table columns={[{ label }, { label: "설정" }, { label: "대상" }, { label: "중요도" }, { label: "사용" }, ...(canEdit ? [{ label: "관리" }] : [])]}>
        <tbody>
          {terms.map((t) => (
            <tr key={t.id}>
              <td>{t.term}</td>
              <td className="text-secondary">{detail(t)}</td>
              <td className="nowrap">{t.targets.map((x) => RULE_TARGET_LABELS[x]).join(", ")}</td>
              <td className="nowrap"><Badge tone={t.severity === "must" ? "warn" : "neutral"}>{SEVERITY_LABELS[t.severity]}</Badge></td>
              <td className="nowrap"><Switch label={`${t.term} 사용`} hideLabel checked={t.enabled} disabled={!canEdit} onChange={(on) => void toggle(t, on)} /></td>
              {canEdit && (
                <td className="nowrap">
                  <div className="row row-tight">
                    <Button size="sm" variant="ghost" onClick={() => onEdit(t)}>수정</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(t)}>삭제</Button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
