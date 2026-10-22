import { Button, Checkbox, IconButton, Input, Textarea } from "../../../ui";
import { MAX_QUESTIONS, type DocumentGate, type GateQuestion } from "../../../../shared/leads";
import { randomId } from "../common";

type Patch = (patch: Partial<DocumentGate>) => void;

function BaseFields({ gate, g }: { gate: DocumentGate; g: Patch }) {
  return (
    <div className="stack-tight" role="group" aria-label="받을 항목">
      <span className="field-label">받을 항목 (이메일은 항상 받아요)</span>
      <Checkbox label="이름" checked={gate.fields.name} onChange={(e) => g({ fields: { ...gate.fields, name: e.target.checked } })} />
      <Checkbox label="소속" checked={gate.fields.company} onChange={(e) => g({ fields: { ...gate.fields, company: e.target.checked } })} />
      <Checkbox label="전화번호 (켜면 알림톡 수신 동의를 따로 받아요)" checked={gate.fields.phone} onChange={(e) => g({ fields: { ...gate.fields, phone: e.target.checked } })} />
    </div>
  );
}

function QuestionRow({ q, index, gate, g }: { q: GateQuestion; index: number; gate: DocumentGate; g: Patch }) {
  const update = (patch: Partial<GateQuestion>) => g({ questions: gate.questions.map((x) => (x.id === q.id ? { ...x, ...patch } : x)) });
  return (
    <div className="row">
      <div className="grow">
        <Input aria-label={`질문 ${index + 1}`} value={q.label} onChange={(e) => update({ label: e.target.value })} />
      </div>
      <Checkbox label="필수" checked={q.required} onChange={(e) => update({ required: e.target.checked })} />
      <IconButton icon="x" label={`질문 ${index + 1} 빼기`} size="sm" onClick={() => g({ questions: gate.questions.filter((x) => x.id !== q.id) })} />
    </div>
  );
}

function QuestionsEditor({ gate, g }: { gate: DocumentGate; g: Patch }) {
  return (
    <div className="stack-tight" role="group" aria-label="직접 질문">
      <span className="field-label">직접 질문 (최대 {MAX_QUESTIONS}개, 3~5개를 권해요)</span>
      {gate.questions.map((q, i) => <QuestionRow key={q.id} q={q} index={i} gate={gate} g={g} />)}
      {gate.questions.length < MAX_QUESTIONS && (
        <div><Button size="sm" variant="secondary" onClick={() => g({ questions: [...gate.questions, { id: randomId(), label: "", required: false }] })}>질문 추가</Button></div>
      )}
    </div>
  );
}

// 게이트를 켰을 때만 보이는 설정: 받을 항목, 직접 질문, 회사 이메일만, 인증, 차단 목록
export function GateFieldsEditor({ gate, g, blocked, setBlocked }: { gate: DocumentGate; g: Patch; blocked: string; setBlocked: (v: string) => void }) {
  return (
    <>
      <BaseFields gate={gate} g={g} />
      <QuestionsEditor gate={gate} g={g} />
      <Checkbox label="회사 이메일만 받기 (gmail, naver 같은 무료 메일 막기)" checked={gate.companyEmailOnly} onChange={(e) => g({ companyEmailOnly: e.target.checked })} />
      <Checkbox label="이메일 인증 후 열람 (준비 중, 지금은 설정만 저장돼요)" checked={gate.requireVerify} onChange={(e) => g({ requireVerify: e.target.checked })} />
      <Textarea label="차단할 이메일·도메인" hint="한 줄에 하나. 예: rival.com, someone@example.com" value={blocked} onChange={(e) => setBlocked(e.target.value)} />
    </>
  );
}
