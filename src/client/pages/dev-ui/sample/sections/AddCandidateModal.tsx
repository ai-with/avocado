import { useState, type FormEvent } from "react";
import { Button, Input, Modal } from "../../../../ui";
import type { NewCandidate } from "../useSampleCandidates";

type Errors = Partial<Record<keyof NewCandidate, string>>;

function validate(v: NewCandidate): Errors {
  const errors: Errors = {};
  if (!v.name.trim()) errors.name = "이름을 입력해 주세요.";
  if (!v.handle.trim().replace(/^@/, "")) errors.handle = "인스타 핸들을 입력해 주세요.";
  return errors;
}

type Props = { onClose: () => void; onSave: (v: NewCandidate) => void };

export function AddCandidateModal({ onClose, onSave }: Props) {
  const [form, setForm] = useState<NewCandidate>({ name: "", handle: "" });
  const [errors, setErrors] = useState<Errors>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = validate(form);
    setErrors(next);
    if (Object.keys(next).length === 0) onSave(form);
  };

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>취소</Button>
      <Button type="submit" form="add-candidate-form">후보 추가</Button>
    </>
  );

  return (
    <Modal open title="후보 추가" description="추가하면 검토 중 상태로 목록 맨 위에 들어가요." onClose={onClose} footer={footer}>
      <form id="add-candidate-form" className="stack" onSubmit={submit} noValidate>
        <Input label="이름" required data-autofocus value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="인스타 핸들" required placeholder="@handle" hint="@는 빼도 돼요." value={form.handle} error={errors.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} />
      </form>
    </Modal>
  );
}
