// 발송(F-66 자동 발송, F-67 1회성 발송) 공용 규칙. 서버와 클라이언트가 같이 쓴다

export type Channel = "email" | "alimtalk";
export type MessageKind = "info" | "ad";
export type Trigger = "form_submitted" | "gate_passed" | "document_completed";
export type DelayMinutes = 0 | 60 | 1440 | 4320;
export type AutomationTarget = { formId?: string; documentId?: string; guideId?: string };

// 본문은 일반 텍스트. 렌더할 때 HTML 로 이스케이프하고 줄바꿈을 살린다
export type EmailTemplate = { subject: string; preview: string; body: string; buttonLabel: string; buttonUrl: string };
export type AlimtalkTemplate = { templateCode: string; variables: Record<string, string> };
export type MessageTemplate = EmailTemplate | AlimtalkTemplate;
export type Audience = { groupIds: string[]; tagIds: string[] };

export const TRIGGER_LABELS: Record<Trigger, string> = {
  form_submitted: "폼 제출",
  gate_passed: "리드 게이트 통과",
  document_completed: "자료 끝까지 읽음",
};
export const DELAY_LABELS: Record<DelayMinutes, string> = { 0: "즉시", 60: "1시간 뒤", 1440: "1일 뒤", 4320: "3일 뒤" };
export const DELAYS: DelayMinutes[] = [0, 60, 1440, 4320];
export const CHANNEL_LABELS: Record<Channel, string> = { email: "이메일", alimtalk: "알림톡" };
export const KIND_LABELS: Record<MessageKind, string> = { info: "정보성", ad: "광고성" };

// 실제 15분 주기와 발송 대기량을 반영한다. 상한 시간으로 약속하지 않는다.
export const DELAY_NOTICE = "보통 예정 시각부터 15분 안에 발송을 시작해요. 대기 중인 메시지가 많으면 더 늦어질 수 있어요.";

// 이메일 변수. {{이름}} 형식
export const VARIABLES = ["이름", "가이드명", "인플루언서명"] as const;
export type VarName = (typeof VARIABLES)[number];
export type Vars = Partial<Record<VarName, string | null>>;

export type SkipReason =
  | "unsubscribed"
  | "bounced"
  | "no_consent"
  | "no_phone"
  | "no_alimtalk_consent"
  | "alimtalk_not_connected"
  | "no_provider"
  | "provider_error"
  | "rule_off"
  | "lead_deleted";
export const REASON_LABELS: Record<SkipReason | "night", string> = {
  unsubscribed: "수신 거부",
  bounced: "반송",
  no_consent: "수신 동의 없음",
  no_phone: "전화번호 없음",
  no_alimtalk_consent: "알림톡 수신 동의 없음",
  alimtalk_not_connected: "카카오톡 채널 미연결",
  no_provider: "이메일 발송 설정 없음",
  provider_error: "발송 사업자 오류",
  rule_off: "규칙이 꺼짐",
  lead_deleted: "삭제된 리드",
  night: "야간 보류",
};

export type SendableLead = { email: string; phone: string | null; marketingOptIn: boolean; alimtalkOptIn: boolean; unsubscribedAt: number | null; bouncedAt: number | null };
export type CanSend = { ok: true } | { ok: false; reason: SkipReason } | { ok: false; reason: "night"; retryAt: number };

const HOUR = 60 * 60 * 1000;
const KST = 9 * HOUR;

// 광고성 야간 보류(21:00~08:00, Asia/Seoul). 보류면 다음 08:00(KST) 시각, 아니면 null
export function nightRetryAt(now: number): number | null {
  const k = new Date(now + KST);
  const hour = k.getUTCHours();
  if (hour >= 8 && hour < 21) return null;
  const eight = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), 8) - KST;
  return hour >= 21 ? eight + 24 * HOUR : eight;
}

// 발송 가능 판정. 수신 거부·반송은 성격과 상관없이 항상 제외한다(정보통신망법 제50조 기준, 세부는 [검증 필요])
export function canSend(lead: SendableLead, channel: Channel, kind: MessageKind, now: number, alimtalkConnected = false): CanSend {
  if (lead.unsubscribedAt) return { ok: false, reason: "unsubscribed" };
  if (lead.bouncedAt && channel === "email") return { ok: false, reason: "bounced" };
  if (channel === "alimtalk") {
    if (!lead.phone) return { ok: false, reason: "no_phone" };
    if (!lead.alimtalkOptIn) return { ok: false, reason: "no_alimtalk_consent" };
    if (!alimtalkConnected) return { ok: false, reason: "alimtalk_not_connected" };
  }
  if (kind === "ad") {
    if (channel === "email" && !lead.marketingOptIn) return { ok: false, reason: "no_consent" };
    const retryAt = nightRetryAt(now);
    if (retryAt) return { ok: false, reason: "night", retryAt };
  }
  return { ok: true };
}

const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function unknownVariables(...texts: string[]): string[] {
  const found = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(VAR_RE)) if (!(VARIABLES as readonly string[]).includes(m[1]!)) found.add(m[1]!);
  return [...found];
}

// 빈 이름은 '고객'으로 채워 "{{이름}}님" 이 어색하지 않게 한다
export function fillVariables(text: string, vars: Vars): string {
  return text.replace(VAR_RE, (whole, name: string) => {
    if (!(VARIABLES as readonly string[]).includes(name)) return whole;
    const v = vars[name as VarName];
    return v || (name === "이름" ? "고객" : "");
  });
}

export const isEmailTemplate = (t: MessageTemplate): t is EmailTemplate => "subject" in t;

export type Check = { key: "channel" | "subject" | "body" | "variables" | "button" | "target" | "sender"; ok: boolean; message: string };

// 발송 전 점검. 하나라도 ok:false 면 켜기·보내기를 막는다
export function validateTemplate(input: { channel: Channel; kind: MessageKind; template: MessageTemplate; hasTarget: boolean; alimtalkConnected: boolean; senderReady: boolean }): Check[] {
  const { channel, kind, template, hasTarget } = input;
  const checks: Check[] = [];
  if (channel === "alimtalk") {
    checks.push({ key: "channel", ok: input.alimtalkConnected, message: input.alimtalkConnected ? "카카오톡 채널이 연결돼 있어요." : "카카오톡 채널 연결이 필요해요." });
    if (kind === "ad") checks.push({ key: "channel", ok: false, message: "알림톡은 정보성 메시지만 보낼 수 있어요." });
    const ok = !isEmailTemplate(template) && !!template.templateCode.trim();
    checks.push({ key: "body", ok, message: ok ? "템플릿을 골랐어요." : "심사를 통과한 템플릿을 골라 주세요." });
  } else if (isEmailTemplate(template)) {
    checks.push({ key: "subject", ok: !!template.subject.trim(), message: template.subject.trim() ? "제목이 있어요." : "제목을 넣어 주세요." });
    checks.push({ key: "body", ok: !!template.body.trim(), message: template.body.trim() ? "본문이 있어요." : "본문을 넣어 주세요." });
    const unknown = unknownVariables(template.subject, template.preview, template.body, template.buttonUrl);
    checks.push({ key: "variables", ok: unknown.length === 0, message: unknown.length ? `지원하지 않는 변수: ${unknown.join(", ")}` : "변수가 모두 올발라요." });
    const label = template.buttonLabel.trim();
    const url = template.buttonUrl.trim();
    const buttonOk = (!label && !url) || (!!label && /^https?:\/\/[^\s]+\.[^\s]+$/.test(url));
    checks.push({ key: "button", ok: buttonOk, message: !label && !url ? "버튼 없이 보내요." : buttonOk ? "버튼 링크가 올발라요." : "버튼 이름과 http(s):// 로 시작하는 링크를 함께 넣어 주세요." });
    checks.push({ key: "sender", ok: input.senderReady, message: input.senderReady ? "발신 주소가 준비돼 있어요." : "발신 주소를 준비하지 못했어요." });
  } else {
    checks.push({ key: "body", ok: false, message: "이메일 내용을 넣어 주세요." });
  }
  checks.push({ key: "target", ok: hasTarget, message: hasTarget ? "대상을 골랐어요." : "대상을 골라 주세요." });
  return checks;
}

export const allPassed = (checks: Check[]) => checks.every((c) => c.ok);

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export type RenderOptions = { kind: MessageKind; senderName: string; senderContact: string; unsubscribeUrl: string };

// 이메일 렌더. 광고성이면 제목 앞 (광고). 성격과 상관없이 끝에 전송자 정보와 수신 거부 링크를 붙인다
export function renderEmail(t: EmailTemplate, vars: Vars, o: RenderOptions): { subject: string; html: string; text: string } {
  const subject = (o.kind === "ad" ? "(광고) " : "") + fillVariables(t.subject, vars);
  const preview = fillVariables(t.preview, vars);
  const body = fillVariables(t.body, vars);
  const buttonUrl = fillVariables(t.buttonUrl, vars);
  const sender = [o.senderName, o.senderContact].filter(Boolean).join(" · ");
  const footerText = `보낸 곳: ${sender}\n더 받고 싶지 않으면 수신 거부: ${o.unsubscribeUrl}`;
  const html = [
    preview && `<div style="display:none;max-height:0;overflow:hidden">${esc(preview)}</div>`,
    `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#1e1d1c">${esc(body).replace(/\n/g, "<br>")}</div>`,
    t.buttonLabel && buttonUrl && `<p><a href="${esc(buttonUrl)}" style="display:inline-block;padding:10px 18px;background:#1e1d1c;color:#fff;border-radius:8px;text-decoration:none">${esc(t.buttonLabel)}</a></p>`,
    `<hr style="border:0;border-top:1px solid #e5e2dc;margin:24px 0"><p style="font-size:12px;color:#8a857d">보낸 곳: ${esc(sender)}<br>더 받고 싶지 않으면 <a href="${esc(o.unsubscribeUrl)}">수신 거부</a></p>`,
  ]
    .filter(Boolean)
    .join("");
  const button = t.buttonLabel && buttonUrl ? `\n${t.buttonLabel}: ${buttonUrl}` : "";
  const text = `${body}${button}\n\n${footerText}`;
  return { subject, html, text };
}

// "누군가 [폼 이름]을 제출하면 → 즉시 → 이메일을 보내요"
export function automationSentence(trigger: Trigger, targetName: string, delay: DelayMinutes, channel: Channel): string {
  const t = targetName || "대상";
  const when = { form_submitted: `누군가 [${t}]을 제출하면`, gate_passed: `누군가 [${t}]의 리드 게이트를 통과하면`, document_completed: `누군가 [${t}]을 끝까지 읽으면` }[trigger];
  return `${when} → ${DELAY_LABELS[delay]} → ${CHANNEL_LABELS[channel]}을 보내요`;
}
