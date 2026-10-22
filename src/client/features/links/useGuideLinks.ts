import { useCallback, useEffect, useState } from "react";
import { useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import type { DestinationType } from "../../../shared/leads";
import { uploadPdf, type Channel, type DocumentRow, type FormRow, type LinkRow } from "./common";

export type GuideLinks = {
  guide: { id: string; name: string; slug: string };
  channels: Channel[];
  influencers: { id: string; name: string; igHandle: string | null; threadsHandle: string | null }[];
  links: LinkRow[];
};

export const hasUtm = (url: string) => /[?&]utm_[a-z]+=/i.test(url);

// 가이드 리드 링크 탭의 데이터와 목적지 선택 상태
function useGuideLinksData(guideId: string) {
  const [data, setData] = useState<GuideLinks | null>(null);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [forms, setForms] = useState<FormRow[]>([]);
  const [open, setOpen] = useState<LinkRow | null>(null);

  const load = useCallback(async () => {
    const [l, d, f] = await Promise.all([
      api.get<GuideLinks>(`/guides/${guideId}/links`),
      api.get<{ documents: DocumentRow[] }>("/documents"),
      api.get<{ forms: FormRow[] }>("/forms"),
    ]);
    setData(l);
    setDocs(d.documents);
    setForms(f.forms);
    setOpen((o) => (o ? (l.links.find((x) => x.id === o.id) ?? null) : null));
  }, [guideId]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, docs, setDocs, forms, open, setOpen, load };
}

function useDestination(docs: DocumentRow[], forms: FormRow[]) {
  const [destType, setDestType] = useState<DestinationType>("document");
  const [destId, setDestId] = useState("");
  const [destUrl, setDestUrl] = useState("");
  const choices = destType === "document" ? docs : destType === "form" ? forms : [];
  useEffect(() => {
    if (destType !== "url" && !choices.some((c) => c.id === destId)) setDestId(choices[0]?.id ?? "");
  }, [destType, choices, destId]);
  const canIssue = destType === "url" ? !!destUrl : !!destId;
  return { destType, setDestType, destId, setDestId, destUrl, setDestUrl, choices, canIssue };
}

// 새 채널 열 추가. 추가 뒤 표를 다시 불러온다
function useAddChannel(load: () => Promise<void>) {
  const toast = useToast();
  const [newChannel, setNewChannel] = useState("");
  const addChannel = async () => {
    if (!newChannel.trim()) return;
    try {
      await api.post("/links/channels", { name: newChannel.trim() });
      setNewChannel("");
      toast("채널을 추가했어요. '인플루언서 전체 발급'을 누르면 새 열에 링크가 생겨요.");
      await load();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };

  return { newChannel, setNewChannel, addChannel };
}

// busy 를 켠 채로 실행하고 실패는 토스트로 알린다
function useBusy() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };
  return { busy, withBusy };
}

export function useGuideLinks(guideId: string) {
  const toast = useToast();
  const base = useGuideLinksData(guideId);
  const dest = useDestination(base.docs, base.forms);
  const { busy, withBusy } = useBusy();

  const upload = async (file: File | undefined) => {
    if (!file) return;
    await withBusy(async () => {
      const doc = await uploadPdf(file, guideId);
      base.setDocs((p) => [doc, ...p]);
      dest.setDestType("document");
      dest.setDestId(doc.id);
      toast("자료를 올렸어요.", "success");
    });
  };

  const issue = async (target: "all" | "shared") => {
    if (dest.destType === "url" && hasUtm(dest.destUrl) && !confirm("목적지 주소에 이미 UTM이 있어요. 링크별 UTM으로 덮어쓸까요?")) return;
    const destination = dest.destType === "url" ? { type: "url", url: dest.destUrl.trim() } : { type: dest.destType, id: dest.destId };
    await withBusy(async () => {
      const r = await api.post<{ created: number; skipped: number }>(`/guides/${guideId}/links/issue`, { destination, target });
      toast(r.created ? `링크 ${r.created}개를 만들었어요.${r.skipped ? ` 이미 있는 ${r.skipped}개는 그대로 뒀어요.` : ""}` : "이미 모든 칸에 링크가 있어요.", "success");
      await base.load();
    });
  };

  const channel = useAddChannel(base.load);
  return { ...base, ...channel, dest, busy, upload, issue };
}

export type GuideLinksState = ReturnType<typeof useGuideLinks>;
