import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ActionBar, Button, ButtonLink, Input, LoadingState, PageHeader, SectionCard, useToast, SelectMenu } from "../../ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import { campaignPath, useBrands } from "./api";

function useCreateCampaign() {
  const navigate = useNavigate();
  const toast = useToast();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const create = async (brandId: string, name: string) => {
    setBusy(true);
    setFields({});
    try {
      const { id } = await api.post<{ id: string }>("/campaigns", { brandId, name });
      toast("캠페인을 만들었어요. 브랜드 가이드를 채워 주세요.", "success");
      navigate(campaignPath(id, "/edit"), { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(false);
    }
  };
  return { fields, busy, create };
}

// /dashboard/campaigns/new: 브랜드 고르기 + 캠페인 이름 → 캠페인과 빈 브랜드 가이드를 만들고 가이드 편집으로
export function CampaignNewPage() {
  const { brands } = useBrands();
  const [brandId, setBrandId] = useState("");
  const [name, setName] = useState("");
  const { fields, busy, create } = useCreateCampaign();
  if (!brands) return <LoadingState />;
  const chosen = brandId || brands[0]?.id || "";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void create(chosen, name);
  };

  return (
    <form onSubmit={submit}>
      <PageHeader title="새 캠페인" description="캠페인을 만들면 빈 브랜드 가이드가 함께 생겨요." back={{ to: "/dashboard/campaigns", label: "캠페인" }} />
      <SectionCard title="캠페인 정보" actions={<ButtonLink size="sm" variant="ghost" to="/dashboard/settings/brands">브랜드 관리</ButtonLink>}>
        <div className="stack">
          <SelectMenu label="브랜드" options={brands.map((b) => ({ value: b.id, label: b.name }))} value={chosen || null} onChange={(v) => v && setBrandId(v)} error={fields.brandId} required />
          <Input label="캠페인 이름" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 가을 신제품 인스타툰" error={fields.name} maxLength={80} required />
        </div>
      </SectionCard>
      <ActionBar status="만들면 브랜드 가이드 편집 화면으로 이동해요.">
        <ButtonLink variant="ghost" to="/dashboard/campaigns">취소</ButtonLink>
        <Button type="submit" loading={busy}>만들기</Button>
      </ActionBar>
    </form>
  );
}
