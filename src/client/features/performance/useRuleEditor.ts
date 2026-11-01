import { useEffect, useState, type FormEvent } from "react";
import { useToast } from "../../ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import type { GuideInfluencerRow } from "../guides/types";
import type { Media, Rule } from "./kdmTypes";

const DEFAULT_MESSAGE = "요청하신 자료 링크예요. {link}";

const initialForm = (rule: Rule | null) => ({
  guideId: rule?.guideId ?? "",
  influencerId: rule?.influencerId ?? "",
  igMediaId: rule?.igMediaId ?? "",
  mediaThumbUrl: rule?.mediaThumbUrl ?? null,
  mediaPermalink: rule?.mediaPermalink ?? null,
  keywords: rule?.keywords.join(", ") ?? "",
  message: rule?.message ?? DEFAULT_MESSAGE,
  publicReplyVariants: rule?.publicReplyVariants ?? [],
});
export type RuleForm = ReturnType<typeof initialForm>;

function useRuleOptions(guideId: string) {
  const [guides, setGuides] = useState<{ id: string; name: string }[]>([]);
  const [infs, setInfs] = useState<GuideInfluencerRow[]>([]);
  const [media, setMedia] = useState<Media[] | null>(null);
  useEffect(() => {
    void api.get<{ guides: { id: string; name: string }[] }>("/guides").then((d) => setGuides(d.guides));
    void api.get<{ media: Media[] }>("/ig/media").then((d) => setMedia(d.media));
  }, []);
  useEffect(() => {
    if (guideId) void api.get<{ rows: GuideInfluencerRow[] }>(`/guides/${guideId}/influencers`).then((d) => setInfs(d.rows));
  }, [guideId]);
  return { guides, infs, media };
}

// 규칙 편집 폼 상태, 선택지 불러오기, 저장
export function useRuleEditor(rule: Rule | null, onSaved: () => Promise<void>, canSend: boolean) {
  const toast = useToast();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [f, setF] = useState<RuleForm>(() => initialForm(rule));
  const options = useRuleOptions(f.guideId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...f, keywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean) };
    try {
      if (rule) {
        const r = await api.patch<{ turnedOff: boolean }>(`/keyword-dm/${rule.id}`, body);
        toast(!canSend ? "저장했어요. 실제 발송 기준을 준비 중이에요." : r.turnedOff ? "저장했어요. 문구가 바뀌어 규칙을 껐어요. 확인 후 다시 켜 주세요." : "저장했어요.", "success");
      } else {
        await api.post("/keyword-dm", body);
        toast(canSend ? "규칙을 만들었어요. 미리보기를 확인하고 켜 주세요." : "초안으로 저장했어요. 실제 발송 기준을 준비 중이에요.", "success");
      }
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      toast(errorMessage(err), "danger");
    }
  };
  return { f, setF, fields, submit, ...options };
}
