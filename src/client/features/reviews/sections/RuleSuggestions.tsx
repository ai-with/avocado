import { useEffect, useState } from "react";
import { Badge, ButtonLink, SectionCard } from "../../../ui";
import { api } from "../../../lib/api";
import { DECISION_REASON_LABELS, type DecisionReason } from "../../../../shared/review";
import { ruleLabel } from "../labels";
import type { RuleStat } from "../types";

const PERCENT = 100;

// 기각이 많이 쌓인 규칙에 문구 수정을 제안한다 (338). 제안할 규칙이 없으면 아무것도 그리지 않는다
export function RuleSuggestions({ guideId }: { guideId?: string }) {
  const [rules, setRules] = useState<RuleStat[]>([]);
  useEffect(() => {
    api
      .get<{ rules: RuleStat[] }>(`/reviews/rule-stats${guideId ? `?guideId=${guideId}` : ""}`)
      .then((r) => setRules(r.rules.filter((x) => x.suggest)))
      .catch(() => setRules([]));
  }, [guideId]);
  if (rules.length === 0) return null;
  return (
    <SectionCard title="자주 기각되는 규칙" description="위반 후보가 계속 기각되는 규칙이에요. 규칙 문구를 고쳐 보세요.">
      <ul className="stack rule-suggest-list">
        {rules.map((r) => <RuleSuggestionRow key={r.ruleId} r={r} />)}
      </ul>
    </SectionCard>
  );
}

function RuleSuggestionRow({ r }: { r: RuleStat }) {
  const reasons = (Object.keys(r.reasons) as DecisionReason[]).filter((k) => r.reasons[k] > 0);
  return (
    <li className="row row-between row-wrap">
      <div className="stack-tight grow">
        <strong>{ruleLabel(r.ruleType)}: {r.ruleContent}</strong>
        <span className="text-caption">판정 {r.decided}건 중 기각 {r.rejected}건 ({Math.round((r.rejected / r.decided) * PERCENT)}%)</span>
        <div className="row row-tight row-wrap">
          {reasons.map((k) => <Badge key={k}>{DECISION_REASON_LABELS[k]} {r.reasons[k]}</Badge>)}
        </div>
        {r.notes.length > 0 && <span className="text-caption">메모: {r.notes.join(", ")}</span>}
      </div>
      <ButtonLink size="sm" to={r.editUrl}>규칙 편집</ButtonLink>
    </li>
  );
}
