import { useState } from "react";
import { useToast } from "../../ui";
import { checkGuidePhoto, PHOTO_PROBLEM_MESSAGE } from "../../../shared/guide-public";

async function postPhoto(file: File): Promise<string> {
  const res = await fetch("/api/guides/photos", { method: "POST", headers: { "Content-Type": file.type }, body: file, credentials: "same-origin" });
  const data: { url?: string; error?: { message: string } } = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error?.message ?? "사진을 올리지 못했어요.");
  return data.url;
}

// 제품 사진 파일 올리기 (AIWITH-368). 서버와 같은 기준으로 먼저 거르고, 올린 주소를 onUploaded 로 넘긴다
export function usePhotoUpload(onUploaded: (url: string) => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const problem = checkGuidePhoto(file.type, file.size);
    if (problem) return setError(PHOTO_PROBLEM_MESSAGE[problem]);
    setError("");
    setBusy(true);
    try {
      onUploaded(await postPhoto(file));
      toast("사진을 올렸어요. 저장하면 가이드에 들어가요.", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "사진을 올리지 못했어요.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, upload };
}
