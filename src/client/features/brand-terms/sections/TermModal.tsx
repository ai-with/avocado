import { useState, type FormEvent } from "react";
import { Button, ChoiceChips, Input, Modal, Select, TagInput, useToast } from "../../../ui";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { TERM_KIND_LABELS, type BrandTerm, type TermMatch } from "../../../../shared/brand-terms";
import { RULE_TARGET_LABELS, SEVERITY_LABELS, type RuleSeverity, type RuleTarget } from "../../../../shared/guides";
import { KIND_TARGETS, termsPath, type TermInput } from "../api";

type Props = { brandId: string; initial: TermInput & { id?: string }; onClose: () => void; onSaved: () => Promise<void> };

const MATCH_OPTIONS: { value: TermMatch; label: string }[] = [
  { value: "exact", label: "그대로 말해야 해요" },
  { value: "similar", label: "비슷한 말도 괜찮아요" },
];
const VARIANT_LABEL: Partial<Record<BrandTerm["kind"], { label: string; hint: string }>> = {
  forbidden: { label: "변형어", hint: "띄어쓰기·줄임말·영어 표기처럼 같은 뜻의 다른 표현을 Enter나 쉼표로 하나씩 넣어 주세요." },
  product_name: { label: "오표기·약칭", hint: "자주 틀리는 표기를 Enter나 쉼표로 하나씩 넣어 주세요. 영상에 나오면 위반 후보가 돼요." },
};
const TERM_PLACEHOLDER: Record<BrandTerm["kind"], string> = { required_ment: "반복 업무를 줄여 줘요", forbidden: "업계 1위", hashtag: "#광고", product_name: "데모 워크플로" };

function useTermForm(props: Props) {
  const toast = useToast();
  const [form, setForm] = useState(props.initial);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.term.trim()) return setFields({ term: "항목을 입력해 주세요." });
    const { id, kind, ...rest } = form;
    const body = { ...rest, term: form.term.trim(), suggestion: form.suggestion?.trim() || null };
    setBusy(true);
    try {
      if (id) await api.patch(`${termsPath(props.brandId)}/${id}`, body);
      else await api.post(termsPath(props.brandId), { ...body, kind });
      toast("저장했어요.", "success");
      await props.onSaved();
      props.onClose();
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(false);
    }
  };
  return { form, setForm, fields, busy, submit };
}

// 사전 항목 추가·수정 모달. 종류는 탭에서 정해지고 바꿀 수 없다
export function TermModal(props: Props) {
  const { form, setForm, fields, busy, submit } = useTermForm(props);
  const kind = form.kind;
  const variant = VARIANT_LABEL[kind];
  const title = `${TERM_KIND_LABELS[kind]} ${form.id ? "수정" : "추가"}`;
  return (
    <Modal open title={title} onClose={props.onClose} footer={<>
      <Button variant="ghost" onClick={props.onClose}>취소</Button>
      <Button type="submit" form="term-form" loading={busy}>저장</Button>
    </>}>
      <form id="term-form" className="stack" noValidate onSubmit={submit}>
        <Input label={TERM_KIND_LABELS[kind]} required data-autofocus placeholder={TERM_PLACEHOLDER[kind]} value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} error={fields.term} maxLength={100} />
        {variant && (
          <TagInput label={variant.label} hint={variant.hint} value={form.variants} onChange={(variants) => setForm({ ...form, variants })} error={fields.variants} />
        )}
        {kind === "forbidden" && <Input label="대체 표현" hint="인플루언서 가이드에 함께 보여 줘요." value={form.suggestion ?? ""} onChange={(e) => setForm({ ...form, suggestion: e.target.value })} maxLength={200} />}
        {kind === "required_ment" && <ChoiceChips label="말하는 방식" options={MATCH_OPTIONS} value={form.match} onChange={(match) => setForm({ ...form, match })} hint="비슷한 말을 허용하면 모델이 뜻을 비교해요." />}
        <ChoiceChips<RuleTarget> label="검사 대상" multiple options={KIND_TARGETS[kind].map((t) => ({ value: t, label: RULE_TARGET_LABELS[t] }))} value={form.targets} onChange={(targets) => setForm({ ...form, targets })} hint={fields.targets ?? (kind === "hashtag" ? "캡션은 아직 자동으로 확인하지 못해 판단 불가로 남아요." : undefined)} />
        <Select label="중요도" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as RuleSeverity })}>
          {(Object.keys(SEVERITY_LABELS) as RuleSeverity[]).map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
        </Select>
        <Input label="메모" hint="팀 안에서만 보여요." value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} />
      </form>
    </Modal>
  );
}
