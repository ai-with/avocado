import { useState, type FormEvent } from "react";
import { Button, Input, Modal, useToast, SelectMenu } from "../../../ui";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { useBrands } from "../../campaigns/api";
import type { GuideCampaign } from "../types";

type Props = { campaign: GuideCampaign; onSaved: () => Promise<void>; onClose: () => void };

// 캠페인 이름·브랜드 수정. 공개 화면 브랜드명은 서버가 캠페인 브랜드를 따라간다 (AIWITH-517)
export function EditCampaignModal({ campaign, onSaved, onClose }: Props) {
  const toast = useToast();
  const { brands } = useBrands();
  const [name, setName] = useState(campaign.name);
  const [brandId, setBrandId] = useState(campaign.brandId);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/campaigns/${campaign.id}`, { name, brandId });
      await onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      toast(errorMessage(err), "danger");
    } finally {
      setSaving(false);
    }
  };

  const brandOptions = (brands ?? [{ id: campaign.brandId, name: campaign.brandName }]).map((b) => ({ value: b.id, label: b.name }));
  return (
    <Modal open title="캠페인 정보 수정" description="브랜드를 바꾸면 인플루언서가 보는 가이드와 메일의 브랜드 이름도 바뀌어요." onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Input label="캠페인 이름" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} maxLength={80} required data-autofocus />
        <SelectMenu label="브랜드" options={brandOptions} value={brandId} onChange={(v) => v && setBrandId(v)} error={fields.brandId} disabled={!brands} />
        <div className="row row-end">
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button type="submit" disabled={saving}>저장</Button>
        </div>
      </form>
    </Modal>
  );
}
