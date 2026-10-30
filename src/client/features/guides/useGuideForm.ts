import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useToast } from "../../ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import { checklistFromRules, emptyVideoGuide, forbiddenTerms, lineWarnings, ruleConflicts, type GuideRule, type VideoGuide } from "../../../shared/guides";
import type { Guide, GuideDictionary, GuideResponse, RuleSet, RuleSetDetail } from "./types";

export type GuideForm = Omit<Guide, "id" | "slug" | "status" | "generatedByModel" | "publishedAt" | "createdAt">;
export type SetField = <K extends keyof GuideForm>(k: K, v: GuideForm[K]) => void;
export type Busy = "" | "save" | "generate";

const MIN_BENEFIT_INPUTS = 3;
const EMPTY: GuideForm = {
  name: "",
  guidelineSetId: null,
  extraRules: [],
  product: { name: "", benefits: ["", "", ""], usage: "", photos: [] },
  purpose: "",
  lengthS: 30,
  lang: "ko",
  deadlineAt: null,
  deliverables: { final: true, clean: false, note: "" },
  secondaryUseScope: { ads: false, media: [], regions: [], months: 0 },
  videoGuide: null,
  brandTermExclusions: [],
};
export const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
export const toDateInput = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

const toPayload = (form: GuideForm, rules: GuideRule[]) => ({
  ...form,
  product: { ...form.product, benefits: form.product.benefits.map((b) => b.trim()).filter(Boolean) },
  videoGuide: form.videoGuide ? { ...form.videoGuide, checklist: checklistFromRules(rules) } : null,
});

// 가이드 폼 상태, 규정 세트 불러오기, 저장·초안 생성 (F-55 가이드 전용 규칙, F-56 초안 생성)
export function useGuideForm() {
  const { id } = useParams();
  const location = useLocation();
  // 새 가이드에서 초안을 만들면 저장 후 편집 주소로 옮기면서 초안을 state 로 넘긴다
  const draftFromNew = (location.state as { draft?: VideoGuide } | null)?.draft ?? null;
  const [form, setForm] = useState<GuideForm>(EMPTY);
  // 미리보기 머리의 브랜드 이름 = 캠페인 브랜드 (TASK-070)
  const [brandName, setBrandName] = useState("");
  const { sets, dictionary } = useGuideLoad(id, draftFromNew, setForm, setBrandName);
  const setRules = useSetRules(form.guidelineSetId);

  const rules = useMemo(() => [...setRules, ...form.extraRules], [setRules, form.extraRules]);
  const warnings = useMemo(() => ruleConflicts(rules), [rules]);
  const vg = form.videoGuide;
  const vgWarnings = useMemo(() => (vg ? lineWarnings(vg, forbiddenTerms(rules)) : []), [vg, rules]);
  const set: SetField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setVg = (patch: Partial<VideoGuide>) => setForm((f) => ({ ...f, videoGuide: { ...(f.videoGuide ?? emptyVideoGuide()), ...patch } }));
  const actions = useGuideSave(id, form, rules, set);

  return { id, form, set, setVg, sets, setRules, rules, warnings, vgWarnings, brandName, dictionary, ...actions };
}

function useGuideLoad(id: string | undefined, draftFromNew: VideoGuide | null, setForm: Dispatch<SetStateAction<GuideForm>>, setBrandName: (name: string) => void) {
  const [sets, setSets] = useState<RuleSet[]>([]);
  const [dictionary, setDictionary] = useState<GuideDictionary | null>(null);
  useEffect(() => {
    void api.get<{ sets: RuleSet[] }>("/guideline-sets").then((d) => {
      setSets(d.sets);
      if (!id && d.sets[0]) setForm((f) => ({ ...f, guidelineSetId: f.guidelineSetId ?? d.sets[0]!.id }));
    });
    if (id)
      void api.get<GuideResponse>(`/guides/${id}`).then(({ guide: g, campaign, dictionary: dict }) => {
        setBrandName(campaign?.brandName ?? "");
        setDictionary(dict);
        setForm({ ...g, videoGuide: draftFromNew ?? g.videoGuide, product: { ...g.product, benefits: [...g.product.benefits, "", "", ""].slice(0, Math.max(MIN_BENEFIT_INPUTS, g.product.benefits.length)) } });
      });
  }, [id, draftFromNew, setForm, setBrandName]);
  return { sets, dictionary };
}

function useSetRules(guidelineSetId: string | null) {
  const [setRules, setSetRules] = useState<GuideRule[]>([]);
  useEffect(() => {
    if (guidelineSetId) void api.get<RuleSetDetail>(`/guideline-sets/${guidelineSetId}`).then((d) => setSetRules(d.rules));
    else setSetRules([]);
  }, [guidelineSetId]);
  return setRules;
}

// 저장·초안 생성 중 표시와 실패 토스트를 한곳에서 처리한다
function useBusyRunner() {
  const toast = useToast();
  const [busy, setBusy] = useState<Busy>("");
  const run = async (kind: Exclude<Busy, "">, task: () => Promise<void>, onError?: (err: unknown) => void) => {
    setBusy(kind);
    try {
      await task();
    } catch (err) {
      onError?.(err);
      toast(errorMessage(err), "danger");
    } finally {
      setBusy("");
    }
  };
  return { busy, run };
}

function useGuideSave(id: string | undefined, form: GuideForm, rules: GuideRule[], set: SetField) {
  const navigate = useNavigate();
  const toast = useToast();
  const [fields, setFields] = useState<Record<string, string>>({});
  const { busy, run } = useBusyRunner();

  // 저장하고 가이드 id 를 돌려준다. 새 가이드면 만든다
  const persist = async (): Promise<string> => {
    setFields({});
    const body = toPayload(form, rules);
    const res = id ? await api.patch<GuideResponse>(`/guides/${id}`, body) : await api.post<GuideResponse>("/guides", body);
    return res.guide.id;
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run("save", async () => {
      const gid = await persist();
      toast("저장했어요.", "success");
      navigate(`/dashboard/campaigns/${gid}`);
    }, (err) => err instanceof ApiError && setFields(err.fields));
  };
  const generate = () => {
    if (!form.product.name.trim()) return setFields({ "product.name": "초안을 만들려면 제품 이름이 필요해요." });
    void run("generate", async () => {
      const gid = await persist();
      const r = await api.post<{ videoGuide: VideoGuide; fallback: boolean; scriptWarning: boolean }>(`/guides/${gid}/generate`);
      if (id) set("videoGuide", r.videoGuide);
      else navigate(`/dashboard/campaigns/${gid}/edit`, { replace: true, state: { draft: r.videoGuide } });
      if (r.fallback) toast("초안 생성이 늦어져 빈 템플릿으로 시작해요.", "neutral");
      else if (r.scriptWarning) toast("초안을 만들었어요. 외국 문자가 섞인 문장을 뺐으니 일부 문장을 다시 확인해 주세요.", "neutral");
      else toast("초안을 만들었어요. 고친 뒤 저장해 주세요.", "success");
    });
  };
  const cancel = () => navigate(id ? `/dashboard/campaigns/${id}` : "/dashboard/campaigns");
  return { fields, busy, save, generate, cancel };
}
