import { useState } from "react";
import { Button, Checkbox, Input, Modal, useToast } from "../../../ui";
import { api, errorMessage } from "../../../lib/api";

export function AddLeadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ email: "", name: "", company: "", phone: "", marketingOptIn: false });
  const save = async () => {
    try {
      await api.post("/leads", v);
      toast("리드를 추가했어요.", "success");
      onDone();
      onClose();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  return (
    <Modal open title="리드 직접 추가" onClose={onClose} footer={<Button onClick={() => void save()}>리드 추가</Button>}>
      <div className="stack">
        <Input label="이메일" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        <Input label="이름" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <Input label="소속" value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} />
        <Input label="전화번호" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        <Checkbox label="이 사람에게 마케팅 수신 동의를 받았어요" checked={v.marketingOptIn} onChange={(e) => setV({ ...v, marketingOptIn: e.target.checked })} />
      </div>
    </Modal>
  );
}
