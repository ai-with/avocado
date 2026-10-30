import { LoadingState, SectionCard, Switch, Table, useToast } from "../../../ui";
import { api, errorMessage } from "../../../lib/api";
import { LEGAL_CATEGORIES, type LegalTerm } from "../../../../shared/cosmetic-ad-terms";
import type { LegalPreset } from "../../../../shared/brand-terms";
import { useCosmeticPreset } from "../api";

type Props = { brandId: string; preset: LegalPreset; canEdit: boolean; reload: () => Promise<void> };

function usePresetSave(brandId: string, reload: () => Promise<void>) {
  const toast = useToast();
  return async (patch: Partial<LegalPreset>) => {
    try {
      await api.patch(`/brands/${brandId}/legal-preset`, patch);
      await reload();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
}

function LegalTable({ terms, off, disabled, onToggle }: { terms: LegalTerm[]; off: Set<string>; disabled: boolean; onToggle: (id: string, on: boolean) => void }) {
  return (
    <Table columns={[{ label: "표현" }, { label: "변형어" }, { label: "대체 표현 예" }, { label: "근거" }, { label: "사용" }]}>
      <tbody>
        {terms.map((t) => (
          <tr key={t.id}>
            <td className="nowrap">{t.term}</td>
            <td className="text-secondary">{t.variants.join(", ")}</td>
            <td className="text-secondary">{t.suggestion ?? ""}</td>
            <td className="text-caption">{t.basis}</td>
            <td className="nowrap"><Switch label={`${t.term} 사용`} hideLabel checked={!off.has(t.id)} disabled={disabled} onChange={(on) => onToggle(t.id, on)} /></td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// 화장품 광고 법규 기본 금지어. 분류별로 묶고 근거를 보여 준다. 항목별·전체 끄기는 이 브랜드에만 적용된다
export function LegalTab({ brandId, preset, canEdit, reload }: Props) {
  const data = useCosmeticPreset();
  const save = usePresetSave(brandId, reload);
  if (!data) return <LoadingState label="법규 기본 목록을 불러오는 중" />;
  const off = new Set(preset.disabled);
  const onToggle = (id: string, on: boolean) => void save({ disabled: on ? preset.disabled.filter((x) => x !== id) : [...preset.disabled, id] });
  const active = data.terms.filter((t) => !off.has(t.id)).length;
  return (
    <div className="stack-loose">
      <Switch
        label="법규 기본 목록 사용"
        description={`${data.terms.length}개 중 ${active}개를 검수에 써요.`}
        checked={preset.enabled}
        disabled={!canEdit}
        onChange={(enabled) => void save({ enabled })}
      />
      <p className="text-caption">공개 자료(화장품법 제13조, 식약처 화장품 표시·광고 관리 지침, 처분 사례 보도)에서 확인한 표현만 넣었어요. 법률 자문 전 기준이라 최종 판단은 직접 해 주세요. 대사에서만 찾아요.</p>
      {LEGAL_CATEGORIES.map((c) => {
        const terms = data.terms.filter((t) => t.category === c);
        return (
          <SectionCard key={c} title={data.categories[c]} description={`${terms.length}개`}>
            <LegalTable terms={terms} off={off} disabled={!canEdit || !preset.enabled} onToggle={onToggle} />
          </SectionCard>
        );
      })}
      <SectionCard title="출처">
        <ul className="list-plain stack-tight">
          {data.sources.map((s) => <li key={s.id}><span className="mono">{s.id}</span> <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></li>)}
        </ul>
      </SectionCard>
    </div>
  );
}
