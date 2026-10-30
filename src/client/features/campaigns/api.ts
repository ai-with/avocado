import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

// 브랜드·캠페인 (TASK-070). 캠페인 id 는 브랜드 가이드 id 와 같다

export type Brand = { id: string; name: string; createdAt: number; campaignCount: number };
export type CampaignStatus = "active" | "archived";
export type CampaignRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  brandId: string;
  brandName: string;
  guideStatus: "draft" | "published";
  createdAt: number;
  influencerCount: number;
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = { active: "진행 중", archived: "보관" };
export const campaignPath = (id: string, sub = "") => `/dashboard/campaigns/${id}${sub}`;

export function useBrands() {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const reload = useCallback(async () => setBrands((await api.get<{ brands: Brand[] }>("/brands")).brands), []);
  useEffect(() => void reload(), [reload]);
  return { brands, reload };
}

export function useCampaigns(brandId: string) {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  useEffect(() => {
    const q = brandId ? `?brandId=${encodeURIComponent(brandId)}` : "";
    void api.get<{ campaigns: CampaignRow[] }>(`/campaigns${q}`).then((d) => setRows(d.campaigns));
  }, [brandId]);
  return rows;
}
