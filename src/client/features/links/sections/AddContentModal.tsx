import { useState, type FormEvent } from "react";
import { Button, Input, Modal } from "../../../ui";
import type { LinkRow } from "../common";

const LABEL_MAX = 50;

type Props = { base: LinkRow; cellName: string; onClose: () => void; onSubmit: (label: string) => Promise<void> };

// 콘텐츠 이름만 받는다. UTM 은 기본 링크를 따르고 utm_content 에 콘텐츠 키가 붙는다
export function AddContentModal({ base, cellName, onClose, onSubmit }: Props) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return setError("콘텐츠 이름을 입력해 주세요.");
    setBusy(true);
    await onSubmit(label.trim());
    setBusy(false);
  };
  return (
    <Modal
      open
      title="콘텐츠별 링크 추가"
      description={`${cellName} 칸에 링크를 하나 더 만들어요. 기존 링크와 클릭 수는 그대로예요.`}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>취소</Button>
        <Button type="submit" form="add-content-link" disabled={busy}>{busy ? "만드는 중" : "링크 만들기"}</Button>
      </>}
    >
      <form id="add-content-link" className="stack" noValidate onSubmit={(e) => void submit(e)}>
        <Input
          label="콘텐츠 이름"
          required
          data-autofocus
          maxLength={LABEL_MAX}
          placeholder="예: 두 번째 릴스"
          hint={`utm_content 는 ${base.utm.content}_c2 처럼 붙어요.`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          error={error}
        />
      </form>
    </Modal>
  );
}
