import { automationSentence, TRIGGER_LABELS, validateTemplate, type AutomationTarget, type Channel, type DelayMinutes, type MessageKind, type MessageTemplate, type Trigger } from "../../../shared/messaging";
import { EMPTY_EMAIL } from "./common";

export type Named = { id: string; name: string };
export type Lookups = { forms: Named[]; documents: Named[]; guides: Named[] };
export type Draft = { name: string; trigger: Trigger; target: AutomationTarget; delayMinutes: DelayMinutes; channel: Channel; kind: MessageKind; template: MessageTemplate };
export type Automation = Draft & { id: string; enabled: boolean; recentSent: number };
export type ListResponse = { automations: Automation[]; lookups: Lookups; alimtalkConnected: boolean };
export type TargetOption = { key: string; label: string };

export const NEW: Draft = { name: "", trigger: "form_submitted", target: {}, delayMinutes: 0, channel: "email", kind: "info", template: EMPTY_EMAIL };
export const TRIGGERS = Object.keys(TRIGGER_LABELS) as Trigger[];

export const targetKey = (t: AutomationTarget) => (t.formId ? `form:${t.formId}` : t.documentId ? `document:${t.documentId}` : t.guideId ? `guide:${t.guideId}` : "");
export function targetFromKey(key: string): AutomationTarget {
  const [type, id] = key.split(":");
  return type === "form" ? { formId: id } : type === "document" ? { documentId: id } : type === "guide" ? { guideId: id } : {};
}
function targetName(t: AutomationTarget, lk: Lookups) {
  const find = (list: Named[], id?: string) => list.find((x) => x.id === id)?.name;
  return find(lk.forms, t.formId) ?? find(lk.documents, t.documentId) ?? (t.guideId ? `${find(lk.guides, t.guideId) ?? "가이드"} 전체` : "");
}
export const sentence = (d: Draft, lk: Lookups) => automationSentence(d.trigger, targetName(d.target, lk), d.delayMinutes, d.channel);
export const checksOf = (d: Draft, connected: boolean) =>
  validateTemplate({ channel: d.channel, kind: d.kind, template: d.template, hasTarget: !!targetKey(d.target), alimtalkConnected: connected, senderReady: true });

export function targetOptions(trigger: Trigger, lk: Lookups): TargetOption[] {
  return [
    ...(trigger === "form_submitted" ? lk.forms.map((f) => ({ key: `form:${f.id}`, label: `폼: ${f.name}` })) : lk.documents.map((x) => ({ key: `document:${x.id}`, label: `자료: ${x.name}` }))),
    ...lk.guides.map((g) => ({ key: `guide:${g.id}`, label: `가이드 전체: ${g.name}` })),
  ];
}
