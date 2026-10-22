import { useEffect, useState } from "react";
import { useToast } from "../../../ui";
import { api, errorMessage } from "../../../lib/api";

export type PreviewItem = { id: string; tMs: number; text: string; textTranslated: string | null };

// 전송 전 번역 미리보기 불러오기 + 회차 보내기
export function useSendPreview(open: boolean, base: string, onClose: () => void, onSent: () => Promise<void>) {
  const toast = useToast();
  const [items, setItems] = useState<PreviewItem[] | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [sendOriginal, setSendOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setItems(null);
    setEdits({});
    setSendOriginal(false);
    void api.post<{ items: PreviewItem[] | null; failed: string[] }>(`${base}/feedback/translate`).then(
      (r) => {
        setItems(r.items);
        setFailed(r.failed);
      },
      (e: unknown) => toast(errorMessage(e), "danger"),
    );
  }, [open, base, toast]);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ round: number; email: { delivered: boolean } }>(`${base}/rounds`, { translations: edits, sendOriginal });
      toast(r.email.delivered ? `${r.round}회차 피드백을 보냈습니다.` : `${r.round}회차 피드백을 저장했습니다. 이메일은 보내지 못했으니 피드백 링크를 전달해 주세요.`, "success");
      onClose();
      await onSent();
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };
  const unresolved = failed.filter((id) => !edits[id]?.trim());
  return { items, failed, edits, setEdits, sendOriginal, setSendOriginal, busy, send, unresolved };
}
