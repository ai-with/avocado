import { Link } from "react-router-dom";
import { SectionCard, Select } from "../../../ui";
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
        <Select label="규정 세트" value={form.guidelineSetId ?? ""} onChange={(e) => set("guidelineSetId", e.target.value || null)} error={fields.guidelineSetId}>
          <option value="">선택 안 함</option>
          {sets.map((s) => <option key={s.id} value={s.id}>{s.name} (규칙 {s.ruleCount}개)</option>)}
        </Select>
        <Warnings items={warnings} />
        {setRules.length > 0 && <RuleEditor readOnly rules={setRules} onAdd={noop} onUpdate={noop} onDelete={noop} />}
        <h5 className="guide-subhead">이 가이드에만 쓰는 규칙</h5>
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
