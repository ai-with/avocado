import { useState } from "react";
import { useToast } from "../../ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import type { GuideProduct } from "../../../shared/guides";
import type { GuideForm, SetField } from "./useGuideForm";

export type ProductImport = { product: GuideProduct; purposeSuggestion: string; sourceUrl: string; fallback: boolean };

const hasProductInput = (p: GuideProduct) => !!(p.name.trim() || p.benefits.some((b) => b.trim()) || p.usage.trim() || p.photos.length);

// 가져온 값이 있는 칸만 바꾼다. 영상 목적은 비어 있을 때만 채운다
function mergeProduct(current: GuideProduct, imported: GuideProduct): GuideProduct {
  return {
    name: imported.name || current.name,
    benefits: imported.benefits.some(Boolean) ? imported.benefits : current.benefits,
    usage: imported.usage || current.usage,
    photos: imported.photos.length ? imported.photos : current.photos,
  };
}

// 상품 URL 로 기본 정보 채우기. 이미 입력한 칸이 있으면 pending 에 두고 확인을 받는다
export function useProductImport(form: GuideForm, set: SetField) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<ProductImport | null>(null);

  const apply = (r: ProductImport) => {
    set("product", mergeProduct(form.product, r.product));
    if (!form.purpose.trim() && r.purposeSuggestion) set("purpose", r.purposeSuggestion);
    setPending(null);
    toast(r.fallback ? "AI 정리가 늦어 페이지 정보만 채웠어요. 확인 후 초안 만들기를 눌러 주세요." : "상품 정보를 채웠어요. 확인 후 초안 만들기를 눌러 주세요.", r.fallback ? "neutral" : "success");
  };

  const run = async () => {
    if (!url.trim()) return setError("상품 페이지 주소를 넣어 주세요.");
    setError("");
    setBusy(true);
    try {
      const r = await api.post<ProductImport>("/guides/import-product", { url: url.trim() });
      if (hasProductInput(form.product)) setPending(r);
      else apply(r);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.url ?? err.message) : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return { url, setUrl, busy, error, pending, run, apply, cancel: () => setPending(null) };
}
