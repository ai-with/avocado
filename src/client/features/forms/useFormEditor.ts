import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import type { FormQuestion } from "../../../shared/leads";
import { uploadImage, type DocumentRow, type LinkRow } from "../links/common";
import { EMPTY, type Draft, type Named, type Submission } from "./form-model";

const isFormLink = (id: string) => (l: LinkRow) => l.destinationType === "form" && l.destinationId === id;

// 폼 편집 화면이 쓰는 주변 데이터(자료, 가이드, 제출, 링크)
function useFormResources(id: string, isNew: boolean, setD: (d: Draft) => void) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [guides, setGuides] = useState<Named[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  useEffect(() => {
    void api.get<{ documents: DocumentRow[] }>("/documents").then((r) => setDocs(r.documents));
    void api.get<{ guides: Named[] }>("/guides").then((r) => setGuides(r.guides), () => setGuides([]));
    if (isNew) return;
    void api.get<{ form: Draft }>(`/forms/${id}`).then((r) => setD(r.form));
    void api.get<{ submissions: Submission[] }>(`/forms/${id}/submissions`).then((r) => setSubs(r.submissions));
    void api.get<{ links: LinkRow[] }>("/links").then((r) => setLinks(r.links.filter(isFormLink(id))));
  }, [id, isNew]);
  return { docs, guides, subs, links, setLinks };
}

export function useFormEditor() {
  const { id = "new" } = useParams();
  const [search] = useSearchParams();
  const isNew = id === "new";
  const [d, setD] = useState<Draft>({ ...EMPTY, guideId: search.get("guideId") });
  const resources = useFormResources(id, isNew, setD);
  const set = (patch: Partial<Draft>) => setD((p) => ({ ...p, ...patch }));
  const setQ = (qid: string, patch: Partial<FormQuestion>) => set({ fields: { ...d.fields, questions: d.fields.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)) } });
  const moveBase = (i: number, dir: -1 | 1) => {
    const base = [...d.fields.base];
    const j = i + dir;
    if (j < 0 || j >= base.length) return;
    [base[i], base[j]] = [base[j]!, base[i]!];
    set({ fields: { ...d.fields, base } });
  };
  const actions = useFormActions(id, isNew, d, set, resources.setLinks);
  return { id, isNew, d, set, setQ, moveBase, ...resources, ...actions };
}

function useFormActions(id: string, isNew: boolean, d: Draft, set: (patch: Partial<Draft>) => void, setLinks: (l: LinkRow[]) => void) {
  const nav = useNavigate();
  const toast = useToast();
  const fail = (e: unknown) => toast(errorMessage(e), "danger");
  const save = async () => {
    try {
      if (isNew) {
        const r = await api.post<{ form: { id: string } }>("/forms", d);
        toast("폼을 만들었어요. 가이드의 '리드 링크' 탭에서 목적지로 고르세요.", "success");
        nav(`/dashboard/forms/${r.form.id}`, { replace: true });
      } else {
        await api.patch(`/forms/${id}`, d);
        toast("저장했어요.", "success");
      }
    } catch (e) {
      fail(e);
    }
  };
  const makeLink = async () => {
    try {
      await api.post("/links", { destination: { type: "form", id }, guideId: d.guideId });
      const r = await api.get<{ links: LinkRow[] }>("/links");
      setLinks(r.links.filter(isFormLink(id)));
    } catch (e) {
      fail(e);
    }
  };
  const pickHeader = async (file: File | undefined) => {
    if (!file) return;
    try {
      set({ headerImageKey: (await uploadImage(file)).key });
    } catch (e) {
      fail(e);
    }
  };
  return { save, makeLink, pickHeader };
}
