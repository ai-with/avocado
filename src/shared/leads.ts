// 리드 도구(F-50~F-53, F-65) 공용 상수와 타입. 서버와 클라이언트가 같이 쓴다

// 기본 채널 6개. 키(채널 ID)는 발급 후 바꾸지 않는다. 직접 추가한 채널은 custom:<id>
export const DEFAULT_CHANNELS = [
  { key: "ig_bio", name: "인스타 바이오" },
  { key: "ig_story", name: "스토리 링크 스티커" },
  { key: "ig_dm", name: "인스타 DM" },
  { key: "ig_comment_dm", name: "댓글 키워드 DM" },
  { key: "threads", name: "스레드" },
  { key: "email", name: "이메일" },
] as const;

export type DestinationType = "document" | "form" | "url";
export type Utm = { source: string; medium: string; campaign: string; content: string; term: string };
export type OgCard = { title?: string; description?: string; imageKey?: string };

export type LeadSourceType = "gate" | "form" | "keyword_dm" | "import" | "manual" | "site";
export const SOURCE_TYPE_LABELS: Record<LeadSourceType, string> = {
  gate: "리드 게이트",
  form: "신청 폼",
  keyword_dm: "댓글 키워드 DM",
  import: "CSV 가져오기",
  manual: "직접 추가",
  site: "사이트",
};

export type GateQuestion = { id: string; label: string; required: boolean };
// position scroll: 본문을 scrollPct(0~100)% 까지 보면 정보 입력 다이얼로그를 띄운다. 0 이면 열자마자
export type DocumentGate = {
  position: "none" | "scroll";
  scrollPct: number;
  fields: { name: boolean; company: boolean; phone: boolean };
  questions: GateQuestion[];
  companyEmailOnly: boolean;
  requireVerify: boolean;
  blockedEmails: string[];
  expiresAt: number | null;
};
export type DocumentSourceType = "editor" | "pdf" | "url";
export const DOC_SOURCE_LABELS: Record<DocumentSourceType, string> = { editor: "직접 쓴 문서", pdf: "PDF", url: "홈페이지 주소" };
// Tiptap JSONContent 와 같은 모양. 서버는 내용을 해석하지 않고 저장만 한다
export type DocJson = { type?: string; attrs?: Record<string, unknown>; content?: DocJson[]; marks?: { type: string; attrs?: Record<string, unknown> }[]; text?: string };

export const DEFAULT_GATE: DocumentGate = {
  position: "none",
  scrollPct: 30,
  fields: { name: true, company: false, phone: false },
  questions: [],
  companyEmailOnly: false,
  requireVerify: false,
  blockedEmails: [],
  expiresAt: null,
};

export type FormQuestionType = "short" | "long" | "single" | "multi" | "date";
export type FormQuestion = { id: string; type: FormQuestionType; label: string; required: boolean; options: string[] };
export type BaseField = "name" | "company" | "phone";
export type FormFields = { base: { key: BaseField; enabled: boolean; required: boolean }[]; questions: FormQuestion[] };
export const DEFAULT_FORM_FIELDS: FormFields = {
  base: [
    { key: "name", enabled: true, required: true },
    { key: "company", enabled: false, required: false },
    { key: "phone", enabled: false, required: false },
  ],
  questions: [],
};
export const BASE_FIELD_LABELS: Record<BaseField, string> = { name: "이름", company: "소속", phone: "전화번호" };
export const QUESTION_TYPE_LABELS: Record<FormQuestionType, string> = {
  short: "단답형",
  long: "장문형",
  single: "단일 선택",
  multi: "복수 선택",
  date: "날짜",
};
export type AfterSubmit = { type: "message" | "document"; text: string; documentId: string | null };
export const MAX_QUESTIONS = 10;

// 그룹 규칙. 출처 필드(guide_id 등)는 "출처 중 하나라도" 기준으로 본다
export type GroupField =
  | "guide_id"
  | "influencer_id"
  | "channel_key"
  | "source_type"
  | "marketing_opt_in"
  | "alimtalk_opt_in"
  | "tag_id"
  | "created_after";
export type GroupOp = "eq" | "neq";
export type GroupCondition = { field: GroupField; op: GroupOp; value: string | number | boolean };
export type GroupRules = { all: GroupCondition[] };

// 무료 메일 도메인. '회사 이메일만 받기'에서 막는다
const FREE_EMAIL_DOMAINS = ["gmail.com", "naver.com", "daum.net", "hanmail.net", "hotmail.com", "outlook.com", "live.com", "icloud.com", "me.com", "kakao.com", "nate.com"];

export function isFreeEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return FREE_EMAIL_DOMAINS.includes(domain) || /^yahoo\.[a-z.]+$/.test(domain);
}

// 차단 목록 항목은 전체 이메일(a@b.com) 또는 도메인(@b.com, b.com)
export function isBlockedEmail(email: string, blocked: string[]): boolean {
  const e = email.trim().toLowerCase();
  const domain = e.split("@")[1] ?? "";
  return blocked.some((raw) => {
    const b = raw.trim().toLowerCase();
    if (!b) return false;
    return b.includes("@") && !b.startsWith("@") ? b === e : b.replace(/^@/, "") === domain;
  });
}

export const channelLabel = (key: string, channels: { key: string; name: string }[]) =>
  channels.find((c) => c.key === key)?.name ?? DEFAULT_CHANNELS.find((c) => c.key === key)?.name ?? key;
