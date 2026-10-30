import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useToast } from "../../ui";
import { pickBody, renderMessage, type MessageLang } from "../../../shared/message-render";
import { useMessageTemplates } from "./api";

// 인플루언서 한 명에게 보낼 메시지: 템플릿 고르기 → 언어 본문 → 값 채우기 → 직접 고치기 (TASK-073)
// path = /guides/:id/influencers/:giId

type Values = { values: Record<MessageLang, Record<string, string>>; lang: MessageLang; hasEmail: boolean };

export function useMessageComposer(path: string) {
  const toast = useToast();
  const { templates } = useMessageTemplates();
  const [ctx, setCtx] = useState<Values | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [lang, setLang] = useState<MessageLang>("ko");
  const [text, setText] = useState("");

  useEffect(() => {
    api
      .get<Values>(`${path}/message-values`)
      .then((v) => {
        setCtx(v);
        setLang(v.lang);
      })
      .catch((e: unknown) => toast(errorMessage(e), "danger"));
  }, [path, toast]);
  useEffect(() => {
    if (templates?.length && !templateId) setTemplateId(templates[0]!.id);
  }, [templates, templateId]);

  const template = templates?.find((t) => t.id === templateId) ?? null;
  const picked = template ? pickBody(template.bodies, lang) : null;
  const result = useMemo(() => (picked && ctx ? renderMessage(picked.body, ctx.values[picked.lang]) : null), [picked?.body, picked?.lang, ctx]);
  // 템플릿·언어가 바뀌면 보낼 내용을 새로 채운다. 그 뒤 직접 고친 내용은 그대로 둔다
  useEffect(() => setText(result?.text ?? ""), [result]);

  return { templates, ctx, template, templateId, setTemplateId, lang, setLang, picked, result, text, setText };
}
