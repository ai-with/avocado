import { Button, Checkbox, Input, NumberField, SectionCard, Select, Textarea, TextField, SelectMenu } from "../../../ui";
import { BASE_FIELD_LABELS, MAX_QUESTIONS, QUESTION_TYPE_LABELS, type AfterSubmit, type FormQuestion, type FormQuestionType } from "../../../../shared/leads";
import { randomId, type DocumentRow } from "../../links/common";
import type { Draft, Named, SetDraft } from "../form-model";

type DraftProps = { d: Draft; set: SetDraft };
const IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif";

export function ContentSection({ d, set, guides, onPickHeader }: DraftProps & { guides: Named[]; onPickHeader: (file: File | undefined) => void }) {
  return (
    <SectionCard title="내용">
      <Input label="제목" value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="예: 무료 체험 신청" />
      <Textarea label="설명" value={d.description} onChange={(e) => set({ description: e.target.value })} />
      <div className="row">
        <label className="btn btn-secondary btn-sm file-pick">
          헤더 이미지 고르기
          <input type="file" accept={IMAGE_TYPES} hidden onChange={(e) => onPickHeader(e.target.files?.[0])} />
        </label>
        {d.headerImageKey && <Button size="sm" variant="ghost" onClick={() => set({ headerImageKey: null })}>이미지 빼기</Button>}
      </div>
      <SelectMenu label="가이드" options={[{ value: "", label: "가이드 없음" }, ...guides.map((g) => ({ value: g.id, label: g.name }))]} value={d.guideId ?? ""} onChange={(v) => set({ guideId: v || null })} />
    </SectionCard>
  );
}

function BaseFieldRows({ d, set, onMove }: DraftProps & { onMove: (i: number, dir: -1 | 1) => void }) {
  const patchBase = (key: string, patch: { enabled?: boolean; required?: boolean }) =>
    set({ fields: { ...d.fields, base: d.fields.base.map((x) => (x.key === key ? { ...x, ...patch } : x)) } });
  return d.fields.base.map((b, i) => (
    <div key={b.key} className="row row-wrap">
      <Checkbox label={BASE_FIELD_LABELS[b.key]} checked={b.enabled} onChange={(e) => patchBase(b.key, { enabled: e.target.checked })} />
      {b.enabled && <Checkbox label="필수" checked={b.required} onChange={(e) => patchBase(b.key, { required: e.target.checked })} />}
      <Button size="sm" variant="ghost" onClick={() => onMove(i, -1)} aria-label={`${BASE_FIELD_LABELS[b.key]} 위로`}>위로</Button>
      <Button size="sm" variant="ghost" onClick={() => onMove(i, 1)} aria-label={`${BASE_FIELD_LABELS[b.key]} 아래로`}>아래로</Button>
    </div>
  ));
}

function QuestionEditor({ q, onChange, onRemove }: { q: FormQuestion; onChange: (patch: Partial<FormQuestion>) => void; onRemove: () => void }) {
  return (
    <div className="lt-q">
      <div className="lt-grid2">
        <Input label="질문" value={q.label} onChange={(e) => onChange({ label: e.target.value })} />
        <Select label="유형" value={q.type} onChange={(e) => onChange({ type: e.target.value as FormQuestionType })}>
          {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      {(q.type === "single" || q.type === "multi") && (
        <Textarea label="보기 (한 줄에 하나)" value={q.options.join("\n")} onChange={(e) => onChange({ options: e.target.value.split("\n") })} onBlur={() => onChange({ options: q.options.map((o) => o.trim()).filter(Boolean) })} />
      )}
      <div className="row">
        <Checkbox label="필수" checked={q.required} onChange={(e) => onChange({ required: e.target.checked })} />
        <Button size="sm" variant="ghost" onClick={onRemove}>질문 빼기</Button>
      </div>
    </div>
  );
}

type FieldsProps = DraftProps & { setQ: (qid: string, patch: Partial<FormQuestion>) => void; onMove: (i: number, dir: -1 | 1) => void };

export function FieldsSection({ d, set, setQ, onMove }: FieldsProps) {
  const questions = d.fields.questions;
  const setQuestions = (next: FormQuestion[]) => set({ fields: { ...d.fields, questions: next } });
  return (
    <SectionCard title="항목" description="이메일은 항상 받아요. 전화번호를 켜면 알림톡 수신 동의 체크가 따로 생겨요.">
      <BaseFieldRows d={d} set={set} onMove={onMove} />
      <span className="field-label">직접 질문 (최대 {MAX_QUESTIONS}개, 3~5개를 권해요)</span>
      {questions.map((q) => <QuestionEditor key={q.id} q={q} onChange={(patch) => setQ(q.id, patch)} onRemove={() => setQuestions(questions.filter((x) => x.id !== q.id))} />)}
      {questions.length < MAX_QUESTIONS && (
        <div>
          <Button size="sm" variant="secondary" onClick={() => setQuestions([...questions, { id: randomId(), type: "short", label: "", required: false, options: [] }])}>질문 추가</Button>
        </div>
      )}
    </SectionCard>
  );
}

const toDateInput = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");
// 마감일은 한국 시간 그날 끝까지 받는다
const fromDateInput = (v: string) => (v ? new Date(`${v}T23:59:59+09:00`).getTime() : null);

export function SubmitSection({ d, set, docs }: DraftProps & { docs: DocumentRow[] }) {
  const setAfter = (patch: Partial<AfterSubmit>) => set({ afterSubmit: { ...d.afterSubmit, ...patch } });
  return (
    <SectionCard title="제출 설정">
      <Select label="제출 후" value={d.afterSubmit.type} onChange={(e) => setAfter({ type: e.target.value as AfterSubmit["type"] })}>
        <option value="message">안내 문구 보여 주기</option>
        <option value="document">자료 연결하기</option>
      </Select>
      <Textarea label="안내 문구" value={d.afterSubmit.text} onChange={(e) => setAfter({ text: e.target.value })} />
      {d.afterSubmit.type === "document" && (
        <SelectMenu label="연결할 자료" placeholder="자료 고르기" options={docs.map((doc) => ({ value: doc.id, label: doc.title }))} value={d.afterSubmit.documentId} onChange={(v) => setAfter({ documentId: v })} />
      )}
      <div className="lt-grid2">
        <TextField label="마감일 (선택)" type="date" value={toDateInput(d.closesAt)} onChange={(e) => set({ closesAt: fromDateInput(e.target.value) })} />
        <NumberField label="최대 제출 수 (선택)" suffix="건" value={d.maxSubmissions} onChange={(v) => set({ maxSubmissions: v })} />
      </div>
      <Textarea label="마감 문구" value={d.closedMessage} onChange={(e) => set({ closedMessage: e.target.value })} />
    </SectionCard>
  );
}
