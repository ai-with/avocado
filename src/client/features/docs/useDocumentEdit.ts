import { useCallback, useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import type { DocumentGate } from "../../../shared/leads";
import type { DocumentDetail } from "../links/common";

const CONTENT_SAVE_DELAY_MS = 2000;
const GATE_SAVE_DELAY_MS = 800;

function useDocumentLoad(id: string) {
  const toast = useToast();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [gate, setGate] = useState<DocumentGate | null>(null);
  const [html, setHtml] = useState("");
  const load = useCallback(async () => {
    const { document: d } = await api.get<{ document: DocumentDetail }>(`/documents/${id}`);
    setDoc(d);
    setGate(d.gate);
    setHtml(d.contentHtml ?? "");
  }, [id]);
  useEffect(() => {
    void load().catch((e: unknown) => toast(errorMessage(e), "danger"));
  }, [load, toast]);
  return { doc, setDoc, gate, setGate, html, setHtml, load };
}

// 본문 자동 저장: 마지막 입력 2초 뒤. 화면을 떠날 때 남은 변경도 보낸다
function useContentAutosave(id: string, setHtml: (h: string) => void) {
  const toast = useToast();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef<{ json: JSONContent; html: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveContent = useCallback(async () => {
    const c = pending.current;
    if (!c) return;
    pending.current = null;
    setSaving(true);
    try {
      const r = await api.patch<{ savedAt: number }>(`/documents/${id}`, { content: c });
      setSavedAt(r.savedAt);
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setSaving(false);
    }
  }, [id, toast]);
  useEffect(() => () => (clearTimeout(timer.current), void saveContent()), [saveContent]);
  const onContent = (json: JSONContent, h: string) => {
    pending.current = { json, html: h };
    setHtml(h);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveContent(), CONTENT_SAVE_DELAY_MS);
  };
  return { savedAt, saving, typing: pending.current !== null, onContent };
}

type Loaded = ReturnType<typeof useDocumentLoad>;

// 노출 시점은 슬라이더를 멈추고 0.8초 뒤 저장
function useGateAutosave(id: string, { gate, setGate, setDoc }: Loaded) {
  const toast = useToast();
  const gateTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (patch: Partial<DocumentGate>) => {
    if (!gate) return;
    const next = { ...gate, ...patch };
    setGate(next);
    clearTimeout(gateTimer.current);
    gateTimer.current = setTimeout(() => {
      api.patch(`/documents/${id}`, { gate: next }).then(
        () => setDoc((d) => (d ? { ...d, gate: next } : d)),
        (e: unknown) => toast(errorMessage(e), "danger"),
      );
    }, GATE_SAVE_DELAY_MS);
  };
}

function useDocumentActions(id: string, { doc, setDoc }: Loaded) {
  const toast = useToast();
  const [refetching, setRefetching] = useState(false);
  const saveTitle = async (title: string) => {
    if (!doc || !title.trim() || title === doc.title) return;
    await api.patch(`/documents/${id}`, { title });
    setDoc({ ...doc, title });
  };
  const refetch = async () => {
    setRefetching(true);
    try {
      const { document: d } = await api.post<{ document: DocumentDetail }>(`/documents/${id}/refetch`, {});
      setDoc(d);
      toast(d.fetchedHtmlKey ? "페이지를 다시 불러왔어요." : "이 주소는 불러올 수 없어요. 새 창으로 열기 링크만 제공할게요.", d.fetchedHtmlKey ? "success" : "danger");
    } finally {
      setRefetching(false);
    }
  };
  return { refetching, saveTitle, refetch };
}

// /documents/:id 편집 화면의 데이터와 저장 동작
export function useDocumentEdit(id: string) {
  const loaded = useDocumentLoad(id);
  const content = useContentAutosave(id, loaded.setHtml);
  const changeGate = useGateAutosave(id, loaded);
  const actions = useDocumentActions(id, loaded);
  return { ...loaded, ...content, ...actions, changeGate };
}

export type DocumentEditState = ReturnType<typeof useDocumentEdit>;
