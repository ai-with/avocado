import { useState, type FormEvent } from "react";
import { Button, Input, Modal, useToast, SelectMenu } from "../../../ui";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { useBrands } from "../../campaigns/api";
import type { GuideCampaign } from "../types";
import { fmtDateTime } from "../types";

type Props = { campaign: GuideCampaign; onSaved: () => Promise<void>; onClose: () => void; archiveOnSave?: boolean };

const localDateTime = (ms: number | null) => {
  if (ms === null) return "";
  const date = new Date(ms), pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// 캠페인 이름·브랜드 수정. 공개 화면 브랜드명은 서버가 캠페인 브랜드를 따라간다 (AIWITH-517)
export function EditCampaignModal({ campaign, onSaved, onClose, archiveOnSave = false }: Props) {
  const toast = useToast();
  const { brands } = useBrands();
  const [name, setName] = useState(campaign.name);
  const [brandId, setBrandId] = useState(campaign.brandId);
  const [endsAt, setEndsAt] = useState(localDateTime(campaign.endsAt));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/campaigns/${campaign.id}`, { name, brandId, endsAt: endsAt ? new Date(endsAt).getTime() : null, ...(archiveOnSave && { status: "archived" }) });
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
    <Modal open title={archiveOnSave ? "캠페인 종료 시각을 알려 주세요" : "캠페인 정보 수정"} description={archiveOnSave ? "캠페인 종료 시각을 저장하고 보관해요. 성과 수집은 지정한 종료 시각 7일 뒤 멈춰요." : "브랜드를 바꾸면 인플루언서가 보는 가이드와 메일의 브랜드 이름도 바뀌어요."} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Input label="캠페인 이름" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} maxLength={80} required data-autofocus />
        <SelectMenu label="브랜드" options={brandOptions} value={brandId} onChange={(v) => v && setBrandId(v)} error={fields.brandId} disabled={!brands} />
        <Input type="datetime-local" label="캠페인 종료 시각" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} error={fields.endsAt} required={archiveOnSave || campaign.status === "archived"} hint="영상 업로드 마감과 별개예요. 이 시각으로부터 7일 뒤 성과 수집을 멈춰요." />
        {campaign.archivedAt !== null && <p className="text-caption">보관한 시각: {fmtDateTime(campaign.archivedAt)}</p>}
        {campaign.status === "archived" && campaign.endsAt === null && <p className="text-secondary">종료 시각이 없어 성과 수집을 멈춘 상태예요. 실제 종료 시각을 입력해 주세요.</p>}
        <div className="row row-end">
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button type="submit" loading={saving} disabled={(archiveOnSave || campaign.status === "archived") && !endsAt}>{archiveOnSave ? "저장하고 보관" : "저장"}</Button>
        </div>
      </form>
    </Modal>
  );
}
