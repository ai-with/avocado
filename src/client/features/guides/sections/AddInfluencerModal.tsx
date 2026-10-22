import { useEffect, useState, type FormEvent } from "react";
import { Button, Modal, Select, useToast } from "../../../ui";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { InfluencerFields, emptyDraft, influencerBody, type InfluencerDraft } from "../InfluencersPage";
import type { Influencer } from "../types";

type Props = { open: boolean; onClose: () => void; base: string; existing: string[]; onAdded: () => Promise<void> };

function useAddInfluencer({ open, onClose, base, existing, onAdded }: Props) {
  const toast = useToast();
  const [all, setAll] = useState<Influencer[]>([]);
  const [pick, setPick] = useState("");
  const [draft, setDraft] = useState<InfluencerDraft>(emptyDraft);
  const [fields, setFields] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) void api.get<{ influencers: Influencer[] }>("/influencers").then((d) => setAll(d.influencers));
  }, [open]);
  const choices = all.filter((i) => !existing.includes(i.id));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post(base, pick ? { influencerId: pick } : influencerBody(draft));
      setPick("");
      setDraft(emptyDraft());
      setFields({});
      onClose();
      await onAdded();
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      toast(errorMessage(err), "danger");
    }
  };
  return { choices, pick, setPick, draft, setDraft, fields, submit };
}

export function AddInfluencerModal(props: Props) {
  const { open, onClose } = props;
  const { choices, pick, setPick, draft, setDraft, fields, submit } = useAddInfluencer(props);
  return (
    <Modal open={open} title="인플루언서 추가" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {choices.length > 0 && (
          <Select label="등록된 인플루언서에서 고르기" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">새로 입력</option>
            {choices.map((i) => <option key={i.id} value={i.id}>{i.displayName}{i.igHandle ? ` (@${i.igHandle})` : ""}</option>)}
          </Select>
        )}
        {!pick && <InfluencerFields draft={draft} onChange={setDraft} fields={fields} />}
        <p className="text-caption">추가하면 이 사람만의 가이드·업로드 링크가 만들어져요. 링크는 30일 동안 열려요.</p>
        <div className="row row-end">
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button type="submit">추가</Button>
        </div>
      </form>
    </Modal>
  );
}
