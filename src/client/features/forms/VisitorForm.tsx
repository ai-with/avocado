import type { ReactNode } from "react";
import { Button, Checkbox, Input, RadioGroup, Textarea } from "../../ui";
import { BASE_FIELD_LABELS, type BaseField, type FormQuestion } from "../../../shared/leads";
import { useVisitorForm } from "./useVisitorForm";
import "../links/lead-tools.css";
import "./forms.css";

export type VisitorValues = {
  email: string;
  name?: string;
  company?: string;
  phone?: string;
  answers: Record<string, string | string[]>;
  privacyAgreed: boolean;
  marketingOptIn: boolean;
  alimtalkOptIn: boolean;
};

type Props = {
  brandName: string;
  title: string;
  description?: string;
  headerImageUrl?: string | null;
  base: { key: BaseField; required: boolean }[];
  questions: FormQuestion[];
  companyEmailOnly?: boolean;
  submitLabel: string;
  preview?: boolean;
  onSubmit?: (v: VisitorValues) => Promise<void>;
  children?: ReactNode;
};

const AUTOCOMPLETE: Record<BaseField, string> = { phone: "tel", name: "name", company: "organization" };

// 리드 게이트 카드와 신청 폼이 같이 쓰는 방문자 입력 화면. 필수 개인정보 동의와 마케팅·알림톡 동의를 분리한다
export function VisitorForm({ brandName, title, description, headerImageUrl, base, questions, companyEmailOnly, submitLabel, preview, onSubmit, children }: Props) {
  const { v, set, answer, errors, busy, submit } = useVisitorForm({ companyEmailOnly, preview, onSubmit });
  return (
    <form className="visitor-card" onSubmit={submit} noValidate>
      {headerImageUrl && <img className="header" src={headerImageUrl} alt="" />}
      <div className="stack-tight">
        <span className="visitor-brand">{brandName}</span>
        <h3>{title}</h3>
        {description && <p className="text-secondary pre-wrap">{description}</p>}
      </div>
      {children}
      <Input label="이메일" type="email" required value={v.email} onChange={(e) => set({ email: e.target.value })} error={errors.email} placeholder="name@company.com" autoComplete="email" />
      {base.map((b) => (
        <Input
          key={b.key}
          label={`${BASE_FIELD_LABELS[b.key]}${b.required ? "" : " (선택)"}`}
          type={b.key === "phone" ? "tel" : "text"}
          required={b.required}
          value={v[b.key] ?? ""}
          onChange={(e) => set({ [b.key]: e.target.value })}
          error={errors[b.key]}
          autoComplete={AUTOCOMPLETE[b.key]}
        />
      ))}
      {questions.map((q) => <QuestionInput key={q.id} q={q} value={v.answers[q.id]} onChange={(a) => answer(q.id, a)} error={errors[`answers.${q.id}`]} />)}
      <ConsentBlock brandName={brandName} base={base} v={v} set={set} error={errors.privacyAgreed} />
      {errors._ && <p className="field-error" role="alert">{errors._}</p>}
      <Button type="submit" loading={busy} disabled={preview}>{submitLabel}</Button>
    </form>
  );
}

type ConsentProps = { brandName: string; base: Props["base"]; v: VisitorValues; set: (patch: Partial<VisitorValues>) => void; error?: string };

function ConsentBlock({ brandName, base, v, set, error }: ConsentProps) {
  const collected = ["이메일", ...base.map((b) => BASE_FIELD_LABELS[b.key])].join(", ");
  const hasPhone = base.some((b) => b.key === "phone");
  return (
    <div className="visitor-consent">
      <Checkbox
        label="[필수] 개인정보 수집·이용에 동의해요"
        checked={v.privacyAgreed}
        onChange={(e) => set({ privacyAgreed: e.target.checked })}
        aria-invalid={!!error}
        description={<>
          수집 항목: {collected}. 목적: 문의 응대와 자료 제공. 보유 기간: 수집일로부터 1년 또는 삭제 요청 시까지. 동의하지 않으면 제출할 수 없어요.{" "}
          {/* TODO: 브랜드별 개인정보 처리방침 URL 연결 */}
          <a href="#privacy" onClick={(e) => e.preventDefault()}>처리방침 보기</a>
        </>}
      />
      {error && <p className="field-error" role="alert">{error}</p>}
      <Checkbox label={`[선택] ${brandName || "브랜드"}의 이메일 광고·소식 받기`} checked={v.marketingOptIn} onChange={(e) => set({ marketingOptIn: e.target.checked })} />
      {hasPhone && <Checkbox label="[선택] 카카오 알림톡으로 광고·소식 받기" checked={v.alimtalkOptIn} onChange={(e) => set({ alimtalkOptIn: e.target.checked })} />}
    </div>
  );
}

type QuestionProps = { q: FormQuestion; value: string | string[] | undefined; onChange: (v: string | string[]) => void; error?: string };

function QuestionInput({ q, value, onChange, error }: QuestionProps) {
  const label = `${q.label}${q.required ? "" : " (선택)"}`;
  if (q.type === "long") return <Textarea label={label} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} error={error} />;
  if (q.type === "date") return <Input label={label} type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} error={error} />;
  if (q.type === "single" || q.type === "multi") return <ChoiceQuestion q={q} label={label} value={value} onChange={onChange} error={error} />;
  return <Input label={label} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} error={error} />;
}

function ChoiceQuestion({ q, label, value, onChange, error }: QuestionProps & { label: string }) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  if (q.type === "single") {
    return <RadioGroup label={label} name={q.id} options={q.options.map((o) => ({ value: o, label: o }))} value={list[0] ?? null} onChange={onChange} error={error} />;
  }
  return (
    <fieldset className="field fieldset-plain">
      <legend className="field-label">{label}</legend>
      <div className="radio-list">
        {q.options.map((o) => (
          <Checkbox key={o} name={q.id} label={o} checked={list.includes(o)} onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} />
        ))}
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </fieldset>
  );
}
