import { useMemo, useState } from "react";
import { ChoiceChips } from "../../../ui";
import { makeT } from "../../../i18n";
import { checklistFromRules, type GuideRule } from "../../../../shared/guides";
import type { GuideLang } from "../../../../shared/guide-public";
import { GuideBody } from "../../public-guide/sections/GuideBody";
import type { PublicGuide } from "../../public-guide/guideTypes";
import type { GuideForm } from "../useGuideForm";
import "../../public-guide/public.css";

const LANG_OPTIONS: { value: GuideLang; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "영어" },
];

// 서버 publicGuideBody 와 같은 모양으로 맞춰 공개 화면 본문을 그대로 그린다
function toPreviewGuide(form: GuideForm, rules: GuideRule[], brandName: string): PublicGuide {
  const enabled = rules.filter((r) => r.enabled);
  return {
    brandName,
    name: form.name || "가이드 이름",
    product: { ...form.product, benefits: form.product.benefits.map((b) => b.trim()).filter(Boolean) },
    purpose: form.purpose,
    lengthS: form.lengthS,
    deadlineAt: form.deadlineAt,
    deliverables: form.deliverables,
    secondaryUseScope: form.secondaryUseScope,
    videoGuide: form.videoGuide,
    rules: enabled.map(({ type, content, severity }) => ({ type, content, severity })),
    checklist: checklistFromRules(enabled),
  };
}

type Props = { form: GuideForm; rules: GuideRule[]; brandName: string; open: boolean };

// 편집 화면 오른쪽 인플루언서용 미리보기 (AIWITH-367). 좁은 화면에서는 open 일 때만 보인다
export function GuidePreviewPanel({ form, rules, brandName, open }: Props) {
  const [lang, setLang] = useState<GuideLang | null>(null);
  const shown = lang ?? form.lang;
  const guide = useMemo(() => toPreviewGuide(form, rules, brandName), [form, rules, brandName]);
  return (
    <aside id="guide-preview" className={`guide-preview ${open ? "is-open" : ""}`} aria-label="인플루언서용 미리보기">
      <div className="guide-preview-head">
        <p className="guide-subhead">인플루언서가 보는 화면</p>
        <ChoiceChips label="미리보기 언어" options={LANG_OPTIONS} value={shown} onChange={setLang} />
      </div>
      <div className="guide-preview-body">
        <GuideBody guide={guide} t={makeT(shown)} lang={shown} />
      </div>
    </aside>
  );
}
