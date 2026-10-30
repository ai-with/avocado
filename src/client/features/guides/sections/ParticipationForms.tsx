import { useState, type FormEvent } from "react";
import { Button, EmptyState, Input, LoadingState, NumberField, Select, Textarea, useToast } from "../../../ui";
import { Link } from "react-router-dom";
import { useMessageVariables } from "../../messages/api";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { EMPTY_TERMS, type ParticipationTerms } from "../../../../shared/participation";
import { CURRENCIES, fromLocalInput, toLocalInput } from "../participation";
import type { GuideInfluencerRow } from "../types";

type Saved = () => Promise<void>;
// 달러 센트까지. 원화도 같은 칸이라 소수 둘째 자리까지 받는다
const AMOUNT_DECIMALS = 2;

function useSave(onSaved: Saved) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      setFields({});
      toast(done, "success");
      await onSaved();
    } catch (e) {
      if (e instanceof ApiError) setFields(e.fields);
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };
  return { busy, fields, run };
}

// 조건: 금액(통화), 산출물, 메모. path = /guides/:id/influencers/:giId
export function TermsForm({ path, terms, canEdit, onSaved }: { path: string; terms: ParticipationTerms | null; canEdit: boolean; onSaved: Saved }) {
  const [draft, setDraft] = useState({ ...EMPTY_TERMS, ...terms, amount: terms?.amount === null || !terms ? "" : String(terms.amount) });
  const { busy, fields, run } = useSave(onSaved);
  const set = (k: keyof typeof draft, v: string) => setDraft({ ...draft, [k]: v });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amount = draft.amount.trim() === "" ? null : Number(draft.amount);
    void run(() => api.patch(`${path}/terms`, { amount, currency: draft.currency, deliverables: draft.deliverables, memo: draft.memo }), "조건을 저장했어요.");
  };
  return (
    <form className="stack" noValidate onSubmit={submit}>
      <div className="grid-2">
        <Select label="통화" value={draft.currency} onChange={(e) => set("currency", e.target.value)} disabled={!canEdit}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c === "KRW" ? "원(KRW)" : "달러(USD)"}</option>)}
        </Select>
        <NumberField
          label="금액"
          suffix={draft.currency === "KRW" ? "원" : "달러"}
          decimal
          maxDecimals={AMOUNT_DECIMALS}
          value={draft.amount.trim() === "" ? null : Number(draft.amount)}
          onChange={(v) => set("amount", v === null ? "" : String(v))}
          error={fields.amount}
          disabled={!canEdit}
        />
      </div>
      <Textarea label="산출물" placeholder="예: 릴스 1개, 스토리 2개" rows={2} value={draft.deliverables} onChange={(e) => set("deliverables", e.target.value)} error={fields.deliverables} disabled={!canEdit} />
      <Textarea label="메모" hint="인플루언서에게는 보이지 않아요." rows={2} value={draft.memo} onChange={(e) => set("memo", e.target.value)} error={fields.memo} disabled={!canEdit} />
      {canEdit && <div className="row row-end"><Button type="submit" size="sm" loading={busy}>조건 저장</Button></div>}
    </form>
  );
}

// 계약 기간: 시작·종료 날짜와 시각. 저장은 TASK-074 의 계약 기간 API
export function ContractForm({ row, canEdit, onSaved }: { row: GuideInfluencerRow; canEdit: boolean; onSaved: Saved }) {
  const [start, setStart] = useState(toLocalInput(row.contractStartAt));
  const [end, setEnd] = useState(toLocalInput(row.contractEndAt));
  const { busy, fields, run } = useSave(onSaved);
  const endBeforeStart = start !== "" && end !== "" && end < start;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (endBeforeStart) return;
    void run(() => api.patch(`/campaign-influencers/${row.id}/contract`, { contractStartAt: fromLocalInput(start), contractEndAt: fromLocalInput(end) }), "계약 기간을 저장했어요.");
  };
  return (
    <form className="stack" noValidate onSubmit={submit}>
      <div className="grid-2">
        <Input label="계약 시작" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} error={fields.contractStartAt} disabled={!canEdit} />
        <Input
          label="계약 종료"
          type="datetime-local"
          hint="이때까지 최종 영상이 올라와야 해요."
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          error={endBeforeStart ? "종료는 시작보다 뒤여야 해요." : fields.contractEndAt}
          disabled={!canEdit}
        />
      </div>
      {canEdit && <div className="row row-end"><Button type="submit" size="sm" disabled={endBeforeStart} loading={busy}>계약 기간 저장</Button></div>}
    </form>
  );
}

// 사용자 변수의 인플루언서별 값(terms.vars). 조건 저장 API 에 조건과 함께 보낸다 (TASK-073)
export function VarsForm({ path, terms, canEdit, onSaved }: { path: string; terms: ParticipationTerms | null; canEdit: boolean; onSaved: Saved }) {
  const { variables } = useMessageVariables();
  const [vars, setVars] = useState<Record<string, string>>(terms?.vars ?? {});
  const { busy, run } = useSave(onSaved);
  if (variables === null) return <LoadingState lines={2} label="변수를 불러오는 중" />;
  if (variables.length === 0) return <EmptyState compact title="아직 사용자 변수가 없어요" description="설정에서 변수를 만들면 여기서 인플루언서마다 값을 넣을 수 있어요." action={<Link to="/dashboard/settings/messages">변수 만들러 가기</Link>} />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const base = { ...EMPTY_TERMS, ...terms };
    void run(() => api.patch(`${path}/terms`, { amount: base.amount, currency: base.currency, deliverables: base.deliverables, memo: base.memo, vars }), "변수 값을 저장했어요.");
  };
  return (
    <form className="stack" noValidate onSubmit={submit}>
      {variables.map((v) => (
        <Input key={v.id} label={v.label} placeholder={v.defaultValue ? `기본값: ${v.defaultValue}` : "기본값 없음"} value={vars[v.key] ?? ""} onChange={(e) => setVars({ ...vars, [v.key]: e.target.value })} disabled={!canEdit} />
      ))}
      {canEdit && <div className="row row-end"><Button type="submit" size="sm" loading={busy}>변수 값 저장</Button></div>}
    </form>
  );
}
