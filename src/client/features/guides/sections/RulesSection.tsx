import { Link } from "react-router-dom";
import { SectionCard, SelectMenu } from "../../../ui";
import type { GuideRule } from "../../../../shared/guides";
import { RuleEditor } from "../RuleEditor";
import { Warnings } from "../GuidelinesPage";
import type { RuleSet } from "../types";
import type { GuideForm, SetField } from "../useGuideForm";

type Props = { form: GuideForm; set: SetField; sets: RuleSet[]; setRules: GuideRule[]; warnings: string[]; fields: Record<string, string> };
const noop = () => {};

export function RulesSection({ form, set, sets, setRules, warnings, fields }: Props) {
  const manageTo = form.guidelineSetId ? `/dashboard/settings/guidelines?set=${form.guidelineSetId}` : "/dashboard/settings/guidelines";
  const extra = form.extraRules;
  return (
    <SectionCard title="규정" actions={<Link to={manageTo}>규정 세트 관리</Link>}>
      <div className="stack">
        <SelectMenu
          label="규정 세트"
          options={[{ value: "", label: "선택 안 함" }, ...sets.map((s) => ({ value: s.id, label: s.name, description: `규칙 ${s.ruleCount}개` }))]}
          value={form.guidelineSetId ?? ""}
          onChange={(v) => set("guidelineSetId", v || null)}
          error={fields.guidelineSetId}
        />
        <Warnings items={warnings} />
        {setRules.length > 0 && <RuleEditor readOnly rules={setRules} onAdd={noop} onUpdate={noop} onDelete={noop} />}
        <h5 className="guide-subhead">이 브랜드 가이드에만 쓰는 규칙</h5>
        <RuleEditor
          rules={extra}
          onAdd={(r) => set("extraRules", [...extra, { ...r, id: `tmp_${crypto.randomUUID()}` }])}
          onUpdate={(rid, patch) => set("extraRules", extra.map((r) => (r.id === rid ? { ...r, ...patch } : r)))}
          onDelete={(rid) => set("extraRules", extra.filter((r) => r.id !== rid))}
        />
      </div>
    </SectionCard>
  );
}
