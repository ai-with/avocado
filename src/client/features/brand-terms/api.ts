import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { BrandTerm, LegalPreset, TermKind } from "../../../shared/brand-terms";
import type { LegalCategory, LegalTerm } from "../../../shared/cosmetic-ad-terms";
import type { RuleTarget } from "../../../shared/guides";

// 브랜드 검수 사전 API (TASK-079)

export type TermsData = { brand: { id: string; name: string; legalPreset: LegalPreset }; terms: BrandTerm[] };
export type CosmeticPreset = { terms: LegalTerm[]; categories: Record<LegalCategory, string>; sources: { id: string; label: string; url: string }[] };
export type TermInput = Omit<BrandTerm, "id">;

export const termsPath = (brandId: string) => `/brands/${brandId}/terms`;

export function useBrandTerms(brandId: string) {
  const [data, setData] = useState<TermsData | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setData(await api.get<TermsData>(termsPath(brandId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "사전을 불러오지 못했어요.");
    }
  }, [brandId]);
  useEffect(() => void reload(), [reload]);
  return { data, error, reload };
}

export function useCosmeticPreset() {
  const [preset, setPreset] = useState<CosmeticPreset | null>(null);
  useEffect(() => void api.get<CosmeticPreset>("/review-presets/cosmetic").then(setPreset), []);
  return preset;
}

// 종류별로 고를 수 있는 검사 대상과 새 항목 기본값
export const KIND_TARGETS: Record<TermKind, RuleTarget[]> = {
  required_ment: ["speech", "screen_text"],
  forbidden: ["speech", "screen_text"],
  hashtag: ["caption", "screen_text"],
  product_name: ["speech", "screen_text"],
};

export const emptyTerm = (kind: TermKind): TermInput => ({
  kind,
  term: "",
  variants: [],
  suggestion: null,
  match: "exact",
  severity: "must",
  targets: kind === "hashtag" ? ["caption"] : kind === "product_name" ? ["speech", "screen_text"] : ["speech"],
  note: "",
  enabled: true,
});
