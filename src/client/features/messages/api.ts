import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { SYSTEM_KEYS, type MessageLang, type TemplatePurpose } from "../../../shared/message-render";

// 메시지 변수·템플릿 (TASK-073)

export type MessageVariable = { id: string; key: string; label: string; defaultValue: string; createdAt: number };
export type MessageTemplate = { id: string; name: string; purpose: TemplatePurpose; bodies: Partial<Record<MessageLang, string>>; updatedAt: number };
export type TemplateDraft = { name: string; purpose: TemplatePurpose; bodies: Record<MessageLang, string> };

export function useMessageVariables() {
  const [variables, setVariables] = useState<MessageVariable[] | null>(null);
  const reload = useCallback(async () => setVariables((await api.get<{ variables: MessageVariable[] }>("/message-variables")).variables), []);
  useEffect(() => void reload(), [reload]);
  return { variables, reload };
}

export function useMessageTemplates() {
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const reload = useCallback(async () => setTemplates((await api.get<{ templates: MessageTemplate[] }>("/message-templates")).templates), []);
  useEffect(() => void reload(), [reload]);
  return { templates, reload };
}

// 본문에서 쓸 수 있는 key 전체: 기본 변수 + 사용자 변수
export const knownKeys = (variables: MessageVariable[] | null): ReadonlySet<string> => new Set([...SYSTEM_KEYS, ...(variables ?? []).map((v) => v.key)]);
